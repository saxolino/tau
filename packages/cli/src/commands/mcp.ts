import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';

import { openLocalMachines, openLocalParameterActors, serveLocalHostMcp } from '@taucad/host';
import type { LocalMachines } from '@taucad/host';
import { createHostGeoSpecRunner, createHostToolRegistry } from '@taucad/host/agent-tools';
import type { AnyRuntimeDefinition } from '@taucad/runtime/worker';
import { systemSkillBundles } from '@taucad/skills/resources';
import { defineCommand } from 'citty';

import { machineProviders } from '#machine-providers.js';

/** Milliseconds a stopping server waits for its kernels before it exits anyway. */
const shutdownGrace = 5000;

/**
 * `tau mcp` command.
 *
 * Serves Tau's CAD tools — evaluate, test, screenshot, export, parameters
 * and the workbench record — over stdio (MCP) to the agent that launched it. The
 * `@taucad/agent-plugin` launcher runs it for Codex and Claude Code; any MCP
 * client may run `tau mcp` itself.
 *
 * Stdout carries the protocol and nothing else: every other write this process
 * makes goes to stderr. The server answers `initialize` before any kernel
 * loads; the first tool call loads the runtime. It exits when the agent closes
 * stdin, on SIGTERM or SIGINT, or when the transport closes, removing the
 * temporary folder its screenshots were saved in.
 *
 * A call works in the first of: `--project`; the folder Codex names with each
 * call (`_meta["codex/sandbox-state-meta"].sandboxCwd`); `CLAUDE_PROJECT_DIR`,
 * which Claude Code sets for the servers it launches; the working directory.
 * Each project gets its own runtime client on its first call.
 *
 * With `--machines` it also serves the print tools over the printers this computer's Tau apps share
 * (`<config>/machines`). A print starts only after the person approves it in the agent app's own form; an app that
 * cannot show one leaves the request for Tau's Print pane. Each print names the project of the folder its call works
 * in. The store has one writer, so the flag is off by default: a server holding it keeps the desktop app from its
 * printers until the agent closes, and a server whose one folder holds no `tau.json` does not take it.
 *
 * @example <caption>Serve one project to an MCP client</caption>
 * ```text
 * tau mcp --project ./bracket
 * ```
 */
/**
 * The viewer page a launcher named, with the digest that names its `ui://` URI.
 *
 * A page that cannot be read leaves the CAD tools serving without the viewer,
 * and says why on stderr: the agent keeps working either way.
 *
 * @param path - The page's path, if any.
 * @returns The page, or `undefined`.
 */
const readViewerPage = async (path: string | undefined): Promise<{ html: string; sha256: string } | undefined> => {
  if (path === undefined || path === '') {
    return undefined;
  }
  try {
    const html = await readFile(resolvePath(path), 'utf8');
    return { html, sha256: createHash('sha256').update(html).digest('hex') };
  } catch (error) {
    process.stderr.write(`tau mcp: serving without the viewer; ${path} could not be read: ${String(error)}\n`);
    return undefined;
  }
};

export const mcpCommand = defineCommand({
  meta: {
    name: 'mcp',
    description: 'Serve Tau CAD tools to a local agent over stdio (MCP)',
  },
  args: {
    project: {
      type: 'string',
      description: 'Project folder for every call (default: the folder the agent names, CLAUDE_PROJECT_DIR, the cwd)',
    },
    plugin: {
      type: 'string',
      description: 'Additional plugin specifier to load (repeatable)',
    },
    config: {
      type: 'string',
      description: 'Path to a tau.config module that exports plugins',
    },
    machines: {
      type: 'boolean',
      description:
        "Offer the print tools over this computer's Tau printers; a print starts only after the person approves it in the agent app (TAU_HOST_MACHINES=true)",
      default: process.env['TAU_HOST_MACHINES'] === 'true',
    },
    'viewer-page': {
      type: 'string',
      description:
        'Single-file viewer page to serve with show_model (default: TAU_VIEWER_PAGE; none disables the viewer)',
    },
  },
  async run({ args }) {
    /* Stdout belongs to the protocol. The transport keeps the original writer;
     * any other write — a kernel's console.log, Emscripten glue, a worker's
     * forwarded stdout — goes to stderr instead of corrupting the stream. */
    const protocolWrite = process.stdout.write.bind(process.stdout);
    const stdout = new Writable({
      write: (chunk: Uint8Array<ArrayBuffer>, _encoding, callback) => {
        protocolWrite(chunk, callback);
      },
    });
    process.stdout.write = process.stderr.write.bind(process.stderr);
    console.log = console.error;
    console.info = console.error;
    console.debug = console.error;

    const stopped = Promise.withResolvers<void>();
    const stop = (): void => {
      stopped.resolve();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.stdin.once('end', stop);
    /* The agent stopped reading. */
    stdout.once('error', stop);

    const workspaceRoot = resolvePath(args.project ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd());
    /* The runtime — every kernel module — loads on the first call, never before
     * `initialize`, and never for a session that calls no tool. */
    let runtime: Promise<AnyRuntimeDefinition> | undefined;
    const openClient = async (projectPath: string) => {
      const [{ loadCliRuntime }, { createNodeClient }] = await Promise.all([
        import('#runtime-options.js'),
        import('@taucad/runtime/node'),
      ]);
      runtime ??= loadCliRuntime({ projectRoot: workspaceRoot, plugin: args.plugin, config: args.config });
      return createNodeClient({ runtime: await runtime, projectPath });
    };
    const clients = new Map<string, ReturnType<typeof openClient>>();
    const clientFor = async (projectPath: string): ReturnType<typeof openClient> => {
      let client = clients.get(projectPath);
      if (client === undefined) {
        client = openClient(projectPath);
        clients.set(projectPath, client);
      }
      return client;
    };
    /* The printers this computer's Tau apps share, before the tools: the print tools are offered only over a store
     * this process holds. Another Tau app holding it leaves the CAD tools serving without printers. A server whose
     * calls all work in one folder (`--project`, or Claude Code's project) holds the store only when that folder is a
     * Tau project; Codex names each call's folder, so a server it starts names the project per call. */
    const opened = args.machines
      ? await openLocalMachines({
          workspaceRoot,
          requireProject: args.project !== undefined || process.env['CLAUDE_PROJECT_DIR'] !== undefined,
          ...(await machineProviders()),
          actorId: 'tau-mcp',
          onWarning: ({ message }) => {
            process.stderr.write(`tau mcp: ${message}\n`);
          },
        })
      : undefined;
    const machines: LocalMachines | undefined = opened === undefined || 'refused' in opened ? undefined : opened;
    if (opened !== undefined && 'refused' in opened) {
      process.stderr.write(
        opened.refused === 'in-use'
          ? 'tau mcp: printers are in use by another Tau app on this computer, so this server offers no print tools. Quit it and restart the agent to print from here.\n'
          : `tau mcp: ${workspaceRoot} holds no tau.json, so this server offers no print tools and leaves the printers to Tau's other apps. Restart the agent in a Tau project to print from here.\n`,
      );
    }
    const checkouts = new Map<string, { readonly cwd: string }>();
    /* `get_parameters` and `apply_parameter_operation`: one actor per entry, writing its sidecar. */
    const parameters = openLocalParameterActors({ runtimeClient: clientFor });
    const registry = createHostToolRegistry({
      workspaceRoot,
      checkouts,
      runtimeClient: clientFor,
      parameterActor: parameters.parameterActor,
      /* `test_model` borrows the project's runtime and runs on the native
       * engine. Delete once taucad/tau#410 makes this the registry default. */
      geospecRunner: async (projectPath) => createHostGeoSpecRunner(projectPath, await clientFor(projectPath)),
      systemSkillBundles,
      ...(machines === undefined ? {} : { machines: machines.facet, projectIdOf: machines.projectOf }),
    });
    const viewerPage = await readViewerPage(args['viewer-page'] ?? process.env['TAU_VIEWER_PAGE']);
    const local = await serveLocalHostMcp(
      { workspaceRoot, pinned: args.project !== undefined, registry, checkouts, viewerPage },
      { stdout },
    );
    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- The SDK server exposes an onclose callback, not EventTarget.
    local.server.server.onclose = stop;

    await stopped.promise;
    const close = async (): Promise<void> => {
      /* The server and its evidence folder go first, so a kernel that ignores
       * shutdown cannot keep the folder past the grace. */
      await local.close();
      try {
        await parameters.close();
      } catch (error) {
        process.stderr.write(`tau mcp: a parameter write did not close: ${String(error)}\n`);
      }
      await machines?.close().catch((error: unknown) => {
        process.stderr.write(`tau mcp: the printer store did not close: ${String(error)}\n`);
      });
      await Promise.allSettled(
        [...clients.values()].map(async (pending) => {
          const client = await pending;
          await client.shutdown();
        }),
      );
    };
    await Promise.race([close(), sleep(shutdownGrace)]);
    // oxlint-disable-next-line unicorn/no-process-exit -- a kernel worker that ignores termination would keep the event loop alive; the protocol is already closed, so no reader is truncated.
    process.exit(0);
  },
});
