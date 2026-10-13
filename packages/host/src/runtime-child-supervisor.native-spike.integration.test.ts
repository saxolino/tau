/**
 * S35 spike (native-dependency-resolution charter, D37 / W11). Not merged; run by
 * `.github/workflows/spike-s35-native-child.yml` on `macos-15` and `ubuntu-latest`.
 *
 * A second, native-only runtime child under Node's permission model holds exactly
 * `--allow-child-process` plus read grants on the payload store and the workspace (and
 * its own code and private temp directory). It launches the build123d and PicoGK workers
 * from the producer trees CI prepares, through the existing native sandbox, and serves
 * them over the loopback WebSocket host as `tau serve`'s child does. The existing
 * permissioned child is started alongside and must report its unchanged flags.
 *
 * Each case writes its raw observations to `$S35_EVIDENCE_DIR/<case>.json` when set.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRuntimeClient } from '@taucad/runtime';
import { fromNodeFs } from '@taucad/runtime/filesystem/node';
import { webSocketTransport } from '@taucad/runtime/transport/websocket';

import { startRuntimeChild } from '#runtime-child-supervisor.js';
import type { RuntimeChildHandle } from '#runtime-child-supervisor.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const childModule = resolve(here, 'runtime-child-supervisor.native-spike-child.mjs');
const wrapModule = resolve(here, 'runtime-child-supervisor.native-spike-wrap.mjs');
const target = `${process.platform}-${process.arch}`;
const producerTrees = {
  build123d: resolve(repoRoot, 'apps/desktop/resources/python', target),
  picogk: resolve(repoRoot, 'apps/desktop/resources/picogk', target),
};
const evidenceDirectory = process.env['S35_EVIDENCE_DIR'];

const record = (name: string, value: unknown): void => {
  const text = JSON.stringify(value, undefined, 2);
  console.log(`S35 ${name} ${JSON.stringify(value)}`);
  if (evidenceDirectory) {
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(join(evidenceDirectory, `${name}.json`), `${text}\n`);
  }
};

type Probe = {
  readonly execArgv: readonly string[];
  readonly nodeVersion: string;
  readonly paths: Record<string, string | undefined>;
  readonly has: Record<string, boolean | string>;
};

const isProbe = (frame: unknown): frame is Probe & { type: 'probe' } =>
  typeof frame === 'object' && frame !== null && (frame as { type?: unknown }).type === 'probe';

let storeRoot: string;
let workspaceRoot: string;
let outsideRoot: string;
const stores: { build123d?: string; picogk?: string } = {};
type Mode = 'strict' | 'widened';
const natives: Partial<Record<Mode, RuntimeChildHandle>> = {};
/* Read roots beyond the store and the workspace that the in-child sandbox wrapper turned out to need. */
let discoveredReadRoots: string[] = [];

const startProbed = async (
  options: Parameters<typeof startRuntimeChild>[0],
): Promise<{ handle: RuntimeChildHandle; probe: Probe }> => {
  let probe: Probe | undefined;
  const handle = await startRuntimeChild({
    ...options,
    onFrame: (frame) => {
      if (isProbe(frame)) {
        probe = frame;
      }
    },
  });
  if (!probe) {
    await handle.close();
    throw new Error('The S35 child sent no probe frame before ready.');
  }
  return { handle, probe };
};

beforeAll(async () => {
  /* The store sits outside the repository and the workspace so its read grant is the only thing that admits it. */
  storeRoot = realpathSync(await mkdtemp(join(tmpdir(), 's35-store-')));
  workspaceRoot = realpathSync(await mkdtemp(join(tmpdir(), 's35-workspace-')));
  outsideRoot = realpathSync(await mkdtemp(join(tmpdir(), 's35-outside-')));
  for (const [kernel, tree] of Object.entries(producerTrees) as Array<[keyof typeof producerTrees, string]>) {
    if (existsSync(join(tree, 'tau-runtime-manifest.json'))) {
      const destination = join(storeRoot, kernel, target);
      mkdirSync(dirname(destination), { recursive: true });
      /* `cp -R` keeps the trees' symlinks and modes, as a sealed store copy does. */
      execFileSync('cp', ['-R', tree, destination]);
      stores[kernel] = destination;
    }
  }
  record('stores', { storeRoot, workspaceRoot, stores, producerTrees });
}, 600_000);

afterAll(async () => {
  for (const handle of Object.values(natives)) {
    // oxlint-disable-next-line no-await-in-loop -- two children, closed in turn.
    await handle.close();
  }
  for (const directory of [storeRoot, workspaceRoot, outsideRoot]) {
    if (directory) {
      // oxlint-disable-next-line no-await-in-loop -- three directories, removed in turn.
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe('S35 existing permissioned child', () => {
  it('keeps its flags and holds no child-process grant', { timeout: 60_000 }, async () => {
    const { handle, probe } = await startProbed({ modulePath: childModule, args: ['--probe-only'] });
    await handle.close();
    record('standard-child', probe);
    const temporary = probe.paths['temporary'];
    /* The literal flag list `permissionArguments` produced on origin/main, in order. */
    expect(probe.execArgv).toEqual([
      '--permission',
      `--allow-fs-read=${process.cwd()}`,
      `--allow-fs-read=${here}`,
      `--allow-fs-read=${temporary}`,
      `--allow-fs-write=${tmpdir()}`,
      `--allow-fs-write=${temporary}`,
    ]);
    expect(probe.has['child']).toBe(false);
    expect(probe.has['worker']).toBe(false);
    expect(probe.has['addon']).toBe(false);
  });
});

describe('S35 in-child sandbox wrapper grants', () => {
  it('discovers the read roots the sandbox wrapper needs under --permission', { timeout: 300_000 }, async () => {
    const temporary = realpathSync(await mkdtemp(join(tmpdir(), 's35w-')));
    const steps: unknown[] = [];
    const grants: string[] = [];
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = spawnSync(
          process.execPath,
          [
            '--permission',
            '--allow-child-process',
            `--allow-fs-read=${repoRoot}`,
            `--allow-fs-read=${storeRoot}`,
            `--allow-fs-read=${workspaceRoot}`,
            `--allow-fs-read=${temporary}`,
            `--allow-fs-write=${temporary}`,
            ...grants.map((grant) => `--allow-fs-read=${grant}`),
            wrapModule,
            storeRoot,
            workspaceRoot,
          ],
          { cwd: workspaceRoot, env: { PATH: process.env['PATH'], TMPDIR: temporary }, encoding: 'utf8', timeout: 60_000 },
        );
        const line = result.stdout.split('\n').find((candidate) => candidate.startsWith('{'));
        const outcome = (line ? JSON.parse(line) : { ok: false, message: result.stderr.slice(-2000) }) as {
          ok: boolean;
          code?: string;
          resource?: string;
          message?: string;
        };
        steps.push(outcome);
        if (outcome.ok || outcome.code !== 'ERR_ACCESS_DENIED' || !outcome.resource) {
          break;
        }
        /* A refusal on a root already granted means Node could not resolve it (a missing path's ancestors): widen. */
        grants.push(grants.includes(outcome.resource) ? dirname(outcome.resource) : outcome.resource);
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
    const last = steps.at(-1) as { ok?: boolean; argv?: string[] } | undefined;
    discoveredReadRoots = last?.ok ? grants : [];
    /* The same wrap without --permission: a wrapper that silently skipped a path it could not read would emit a
     * different sandbox profile under the grants. */
    const unrestrictedTemporary = realpathSync(await mkdtemp(join(tmpdir(), 's35w-')));
    let unrestricted: { ok: boolean; argv?: string[] } | undefined;
    try {
      const result = spawnSync(process.execPath, [wrapModule, storeRoot, workspaceRoot], {
        cwd: workspaceRoot,
        env: { PATH: process.env['PATH'], TMPDIR: unrestrictedTemporary },
        encoding: 'utf8',
        timeout: 60_000,
      });
      const line = result.stdout.split('\n').find((candidate) => candidate.startsWith('{'));
      unrestricted = line ? (JSON.parse(line) as { ok: boolean; argv?: string[] }) : undefined;
    } finally {
      await rm(unrestrictedTemporary, { recursive: true, force: true });
    }
    const normalize = (argv: readonly string[] | undefined, temporaryPath: string): string | undefined =>
      argv?.join('\u0000').replaceAll(temporaryPath, '<TMP>').replaceAll(/[0-9a-f]{8,}/gu, '<HEX>')
        /* The proxy ports are chosen per process. */
        .replaceAll(/\b\d{4,5}\b/gu, '<PORT>');
    const restrictedProfile = normalize(last?.argv, temporary);
    const unrestrictedProfile = normalize(unrestricted?.argv, unrestrictedTemporary);
    record('wrap-grant-discovery', {
      ok: last?.ok === true,
      grants,
      profileIdenticalToUnrestricted: restrictedProfile === unrestrictedProfile,
      restrictedArgv: last?.argv,
      unrestrictedArgv: unrestricted?.argv,
      steps: steps.map((step) => ({ ...(step as object), argv: undefined })),
    });
    /* Records the finding; the strict child below is the S35 pass/fail line. */
    expect(last?.ok, JSON.stringify(steps.at(-1))).toBe(true);
  });
});

const startNative = async (mode: Mode): Promise<{ handle: RuntimeChildHandle; probe: Probe }> => {
  const started = await startProbed({
    modulePath: childModule,
    args: [
      ...(stores.build123d ? ['--build123d-root', stores.build123d] : []),
      ...(stores.picogk ? ['--picogk-root', stores.picogk] : []),
      '--outside-path',
      outsideRoot,
      '--outside-path',
      '/etc',
    ],
    profile: {
      kind: 'native',
      codeRoots: [repoRoot],
      storeRoots: mode === 'strict' ? [storeRoot] : [storeRoot, ...discoveredReadRoots],
      workspaceRoot,
    },
  });
  natives[mode] = started.handle;
  return started;
};

describe('S35 native-only child grants (strict)', () => {
  it('holds exactly the child-process grant and reads on the store and the workspace', { timeout: 120_000 }, async () => {
    const { probe } = await startNative('strict');
    record('native-child-strict', probe);
    const { has } = probe;
    expect(probe.execArgv).toContain('--allow-child-process');
    expect(probe.execArgv.filter((flag) => flag.startsWith('--allow-fs-write='))).toEqual([
      `--allow-fs-write=${probe.paths['temporary']}`,
    ]);
    expect(has['child']).toBe(true);
    expect(has['worker']).toBe(false);
    expect(has['addon']).toBe(false);
    expect(has['wasi']).toBe(false);
    expect(has['fs.read workspace']).toBe(true);
    expect(has['fs.write workspace']).toBe(false);
    expect(has['fs.read home']).toBe(false);
    expect(has['fs.write home']).toBe(false);
    expect(has[`fs.read ${outsideRoot}`]).toBe(false);
    expect(has[`fs.write ${outsideRoot}`]).toBe(false);
    expect(has['fs.read /etc']).toBe(false);
    if (stores.build123d) {
      expect(has['fs.read build123d store']).toBe(true);
      expect(has['fs.write build123d store']).toBe(false);
    }
    if (stores.picogk) {
      expect(has['fs.read picogk store']).toBe(true);
      expect(has['fs.write picogk store']).toBe(false);
    }
  });
});

describe('S35 native-only child grants (widened by the discovered wrapper roots)', () => {
  it('starts with the discovered roots and still refuses writes', { timeout: 120_000 }, async () => {
    const { probe } = await startNative('widened');
    record('native-child-widened', { discoveredReadRoots, probe });
    expect(probe.has['child']).toBe(true);
    expect(probe.has['fs.write home']).toBe(false);
    expect(probe.has[`fs.write ${outsideRoot}`]).toBe(false);
  });
});

const evaluate = async (
  mode: Mode,
  files: Record<string, string>,
  path: string,
): Promise<{ success: boolean; issues: string; geometry: number; milliseconds: number }> => {
  const native = natives[mode];
  if (!native) {
    throw new Error(`The ${mode} native-only child did not start.`);
  }
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(workspaceRoot, name), content);
  }
  const handle = native;
  const client = createRuntimeClient({
    transport: webSocketTransport({
      url: handle.url,
      fileSystem: fromNodeFs(workspaceRoot),
      createSocket: (url) => new WebSocket(url, { headers: { authorization: `Bearer ${handle.authorizationToken}` } }),
    }),
  });
  const started = performance.now();
  const document = client.open({ source: { path }, watch: false });
  try {
    const outcome = await document.evaluation();
    if (outcome.superseded) {
      throw new Error('The only evaluation in this case must not be superseded.');
    }
    const { evaluation } = outcome;
    return {
      success: evaluation.success,
      issues: evaluation.issues.map(({ message }) => message).join('\n'),
      geometry: evaluation.success ? JSON.stringify(evaluation).length : 0,
      milliseconds: Math.round(performance.now() - started),
    };
  } finally {
    document.close();
    await client.shutdown();
  }
};

type Outcomes = Record<string, string>;
const probeOutcomes = (issues: string): { import: Outcomes; main: Outcomes } | undefined => {
  const json = /TAU_SANDBOX_PROBE (?<json>\{.*\})/u.exec(issues)?.groups?.['json'];
  return json ? (JSON.parse(json) as { import: Outcomes; main: Outcomes }) : undefined;
};

const hostileTargets = () => {
  const id = randomUUID();
  return {
    /* Outside the workspace, the store and the artifact root, on the host. */
    outsideEscape: join(outsideRoot, `escape-${id}`),
    tmpEscape: `/tmp/s35-escape-${id}`,
    homeEscape: join(homedir(), `s35-escape-${id}`),
  };
};

const build123dHostile = (paths: ReturnType<typeof hostileTargets>): string => `import errno
import json
import os
import socket
import urllib.request
from dataclasses import dataclass


def _probe(action):
    try:
        action()
        return "allowed"
    except OSError as error:
        return errno.errorcode.get(error.errno, type(error).__name__)
    except Exception as error:
        return type(error).__name__


def _outcomes():
    return {
        "outside_write": _probe(lambda: open(${JSON.stringify(paths.outsideEscape)}, "w").write("escaped")),
        "tmp_write": _probe(lambda: open(${JSON.stringify(paths.tmpEscape)}, "w").write("escaped")),
        "home_write": _probe(lambda: open(${JSON.stringify(paths.homeEscape)}, "w").write("escaped")),
        "socket": _probe(lambda: socket.create_connection(("1.1.1.1", 443), timeout=5)),
        "dns": _probe(lambda: socket.gethostbyname("example.com")),
        "https": _probe(lambda: urllib.request.urlopen("https://example.com", timeout=5).read()),
        "artifact_write": _probe(lambda: open(os.path.join(os.environ["TMPDIR"], "probe.txt"), "w").write("ok")),
    }


IMPORT_OUTCOMES = _outcomes()


@dataclass(frozen=True)
class Params:
    size: float = 1.0


def main(params: Params):
    raise RuntimeError("TAU_SANDBOX_PROBE " + json.dumps({"import": IMPORT_OUTCOMES, "main": _outcomes()}))
`;

const picogkHostile = (paths: ReturnType<typeof hostileTargets>): string => `using System;
using System.IO;
using System.Net.Http;
using System.Net.Sockets;
using PicoGK;

var imported = Sandbox.Outcomes();
Library.Go(1f, () => throw new InvalidOperationException(
    "TAU_SANDBOX_PROBE {\\"import\\":" + imported + ",\\"main\\":" + Sandbox.Outcomes() + "}"));

public static class Sandbox
{
    private static string Probe(Action action)
    {
        try { action(); return "allowed"; }
        catch (Exception error) { return error.GetType().Name; }
    }

    private static string Field(string name, string value) => "\\"" + name + "\\":\\"" + value + "\\"";

    public static string Outcomes() => "{" + string.Join(",", new[]
    {
        Field("outside_write", Probe(() => File.WriteAllText(${JSON.stringify(paths.outsideEscape)}, "escaped"))),
        Field("tmp_write", Probe(() => File.WriteAllText(${JSON.stringify(paths.tmpEscape)}, "escaped"))),
        Field("home_write", Probe(() => File.WriteAllText(${JSON.stringify(paths.homeEscape)}, "escaped"))),
        Field("socket", Probe(() => { using var client = new TcpClient(); client.Connect("1.1.1.1", 443); })),
        Field("https", Probe(() => { using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) }; http.GetStringAsync("https://example.com").GetAwaiter().GetResult(); })),
        Field("artifact_write", Probe(() => File.WriteAllText(Path.Combine(Path.GetTempPath(), "probe.txt"), "ok"))),
    }) + "}";
}
`;

/* A probe outcome other than "allowed" is a refusal; on Linux a write may land in bubblewrap's throwaway tmpfs
 * ("allowed" inside the sandbox), so the decisive check is that nothing reached the host. */
const assertContained = (
  outcomes: { import: Outcomes; main: Outcomes },
  paths: ReturnType<typeof hostileTargets>,
): void => {
  for (const phase of ['import', 'main'] as const) {
    const outcome = outcomes[phase];
    expect(outcome['socket'], `${phase} socket`).not.toBe('allowed');
    expect(outcome['https'], `${phase} https`).not.toBe('allowed');
    if (outcome['dns'] !== undefined) {
      expect(outcome['dns'], `${phase} dns`).not.toBe('allowed');
    }
    expect(outcome['artifact_write'], `${phase} artifact_write`).toBe('allowed');
    if (process.platform === 'darwin') {
      expect(outcome['outside_write'], `${phase} outside_write`).not.toBe('allowed');
      expect(outcome['home_write'], `${phase} home_write`).not.toBe('allowed');
    }
  }
  for (const path of Object.values(paths)) {
    expect(existsSync(path), path).toBe(false);
  }
};

const picogkEngine = (): boolean => {
  if (!stores.picogk) {
    return false;
  }
  const manifest = JSON.parse(readFileSync(join(stores.picogk, 'tau-runtime-manifest.json'), 'utf8')) as {
    resourceFiles: ReadonlyArray<{ path: string }>;
  };
  return manifest.resourceFiles.some(({ path }) => /^picogk\.\d/u.test(path));
};

describe.each(['strict', 'widened'] as const)('S35 build123d through the %s native-only child', (mode) => {
  it('reaches ready and evaluates a box', { timeout: 300_000 }, async () => {
    expect(stores.build123d, 'build123d producer tree').toBeDefined();
    const result = await evaluate(
      mode,
      {
        'box.py': `from dataclasses import dataclass
from build123d import Box


@dataclass(frozen=True)
class Params:
    size: float = 10.0


def main(params: Params):
    return Box(params.size, params.size * 2, params.size * 3)
`,
      },
      'box.py',
    );
    record(`build123d-ready-${mode}`, result);
    expect(result.success, result.issues).toBe(true);
  });

  it('refuses a write outside the workspace and a network call from the worker', { timeout: 300_000 }, async () => {
    const paths = hostileTargets();
    try {
      const result = await evaluate(mode, { 'hostile.py': build123dHostile(paths) }, 'hostile.py');
      const outcomes = probeOutcomes(result.issues);
      record(`build123d-denied-${mode}`, { result: { ...result, issues: result.issues.slice(0, 4000) }, outcomes, paths });
      expect(outcomes, result.issues).toBeDefined();
      assertContained(outcomes!, paths);
    } finally {
      for (const path of Object.values(paths)) {
        rmSync(path, { force: true });
      }
    }
  });
});

describe.each(['strict', 'widened'] as const)('S35 PicoGK through the %s native-only child', (mode) => {
  it('reaches ready and evaluates a cube', { timeout: 300_000 }, async (context) => {
    expect(stores.picogk, 'PicoGK producer tree').toBeDefined();
    const engine = picogkEngine();
    const result = await evaluate(
      mode,
      {
        'cube.cs':
          'using System.Numerics; using PicoGK; Library.Go(1f, () => { Library.oViewer().Add(Utils.mshCreateCube(new Vector3(2, 4, 6))); });',
      },
      'cube.cs',
    );
    record(`picogk-ready-${mode}`, { engine, ...result, issues: result.issues.slice(0, 4000) });
    if (!engine) {
      /* Upstream PicoGK ships no Linux voxel library; the managed worker launches but cannot build geometry. */
      context.skip();
    }
    expect(result.success, result.issues).toBe(true);
  });

  it('refuses a write outside the workspace and a network call from the worker', { timeout: 300_000 }, async () => {
    expect(stores.picogk, 'PicoGK producer tree').toBeDefined();
    const paths = hostileTargets();
    try {
      const result = await evaluate(mode, { 'hostile.cs': picogkHostile(paths) }, 'hostile.cs');
      const outcomes = probeOutcomes(result.issues);
      record(`picogk-denied-${mode}`, {
        engine: picogkEngine(),
        result: { ...result, issues: result.issues.slice(0, 4000) },
        outcomes,
        paths,
      });
      expect(outcomes, result.issues).toBeDefined();
      assertContained(outcomes!, paths);
    } finally {
      for (const path of Object.values(paths)) {
        rmSync(path, { force: true });
      }
    }
  });
});
