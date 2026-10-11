/**
 * The per-user machine store for a host that runs beside one project folder: `tau serve --machines` and
 * `tau mcp --machines` (agent plugin UI blueprint W11, G24).
 *
 * Every Tau host on a computer shares `<config>/machines`: the bindings, the print ledger and the host's secret vault
 * for access codes. One writer holds it at a time; a second host serves without machines and says why, rather than
 * failing.
 *
 * @public
 */

import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { createHostAdmissionAuthority } from '@taucad/runtime/host';
import type { HostSessionHandle } from '@taucad/runtime/host';
import { createNodeMachineHost } from '@taucad/runtime/host/node';
import type { CreateNodeMachineHostInput, NodeMachineHost } from '@taucad/runtime/host/node';
import type { MachineClient } from '@taucad/runtime/machine';
import type { RuntimeTransportFacet } from '@taucad/runtime/transport';

import { defaultConfigDirectory } from '#credential-store.js';
import {
  createMachineSecretStore,
  createNodeMachineRuntime,
  localMachineFacet,
  machineRouteGrants,
  openMachineHostIdentity,
  readProjectId,
} from '#machine-host.js';
import type { CreateNodeMachineRuntimeOptions } from '#machine-host.js';
import { openSecretVault } from '#secret-vault.js';

/** A machine host over the shared store, with the one session its route and tools use. @public */
export type SharedMachineHost = Readonly<{ host: NodeMachineHost; session: HostSessionHandle }>;

/** Options for {@link openSharedMachineHost}. @public */
export type OpenSharedMachineHostOptions = Readonly<{
  /** The machine providers the host admits. */
  providers: CreateNodeMachineHostInput['providers'];
  /** Finds a print request's file. */
  readArtifact: CreateNodeMachineRuntimeOptions['readArtifact'];
  /** Told a provider's warnings and errors, and the host's own failures, in words. */
  onWarning: (warning: Readonly<{ code: 'MACHINE_PROVIDER' | 'MACHINE_HOST'; message: string }>) => void;
  /** Who the session acts for, in the ledger. */
  actorId: string;
  /** The store; `<config>/machines` unless a test names another. */
  storeRoot?: string | undefined;
}>;

/**
 * Open the per-user machine store, `<config>/machines`: the one store the desktop app and every other Tau host on
 * this computer share.
 *
 * One identity beside it, the host's secret vault (`TAU_SECRET_VAULT` overrides its kind), and one trusted session
 * for the route and the tools.
 *
 * @param options - Providers, artifact reader, warning sink and actor.
 * @returns The host and its session, or `undefined` while another Tau app holds the store's writer lock.
 * @public
 */
export const openSharedMachineHost = async (
  options: OpenSharedMachineHostOptions,
): Promise<SharedMachineHost | undefined> => {
  const storeRoot = options.storeRoot ?? join(defaultConfigDirectory(), 'machines');
  const identity = await openMachineHostIdentity(storeRoot);
  let host: NodeMachineHost;
  try {
    host = await createNodeMachineHost({
      storeRoot,
      ...identity,
      admission: createHostAdmissionAuthority({ hostId: identity.hostId }),
      providers: options.providers,
      runtime: createNodeMachineRuntime({
        secrets: createMachineSecretStore({
          vault: openSecretVault({ directory: storeRoot, env: process.env }),
          legacyDirectory: storeRoot,
        }),
        readArtifact: options.readArtifact,
        log: (entry) => {
          if (entry.level === 'error' || entry.level === 'warning') {
            options.onWarning({ code: 'MACHINE_PROVIDER', message: entry.message });
          }
        },
      }),
      onError: (error) => {
        options.onWarning({ code: 'MACHINE_HOST', message: error instanceof Error ? error.message : String(error) });
      },
    });
  } catch (error) {
    if ((error as { readonly code?: unknown }).code !== 'AUTHORITY_ALREADY_OWNED') {
      throw error;
    }
    return undefined;
  }
  return {
    host,
    session: host.issueSession({ actor: { kind: 'user', id: options.actorId }, grants: machineRouteGrants }),
  };
};

/** The machines a host beside one project folder offers its tools. @public */
export type LocalMachines = Readonly<{
  /** The facet the tool registry's machine tools use. */
  facet: RuntimeTransportFacet<MachineClient>;
  /** The folder's `tau.json` id, which every print artifact names; without one nothing can be printed. */
  projectId: string | undefined;
  /** Retire the session and release the store. */
  close(): Promise<void>;
}>;

/** Options for {@link openLocalMachines}. @public */
export type OpenLocalMachinesOptions = Omit<OpenSharedMachineHostOptions, 'readArtifact'> &
  Readonly<{
    /** The project folder whose files print requests name. */
    workspaceRoot: string;
  }>;

/**
 * Open the shared machine store for a host that serves one project folder, such as `tau mcp --machines`.
 *
 * A print request's file is read only from that folder, only when the request names the folder's `tau.json` id,
 * and only when its digest matches; a path that leaves the folder is refused.
 *
 * @param options - The folder, providers, warning sink and actor.
 * @returns The facet and project id, or `undefined` while another Tau app holds the store.
 * @public
 */
export const openLocalMachines = async (options: OpenLocalMachinesOptions): Promise<LocalMachines | undefined> => {
  const root = await realpath(options.workspaceRoot);
  const projectId = await readProjectId({
    stat: async (path) => stat(join(root, path)),
    readFile: async (path) => new Uint8Array(await readFile(join(root, path))),
  });
  const shared = await openSharedMachineHost({
    ...options,
    readArtifact: async (artifact) => {
      const target = resolve(root, artifact.path);
      const inside = relative(root, target);
      if (
        projectId === undefined ||
        artifact.projectId !== projectId ||
        inside === '' ||
        isAbsolute(inside) ||
        inside.startsWith(`..${sep}`) ||
        inside === '..'
      ) {
        throw new Error('MACHINE_ARTIFACT_NOT_FOUND');
      }
      /* A symlink inside the folder must not lead out of it. */
      const real = await realpath(target).catch(() => undefined);
      if (real === undefined || !real.startsWith(`${root}${sep}`)) {
        throw new Error('MACHINE_ARTIFACT_NOT_FOUND');
      }
      const bytes = new Uint8Array(await readFile(real));
      if (`sha256:${createHash('sha256').update(bytes).digest('hex')}` !== artifact.digest) {
        throw new Error('MACHINE_ARTIFACT_NOT_FOUND');
      }
      return bytes;
    },
  });
  if (shared === undefined) {
    return undefined;
  }
  const facet = localMachineFacet((port) => shared.host.serve({ port, session: shared.session }));
  return {
    facet,
    projectId,
    close: async () => {
      facet.close();
      await shared.host.close();
    },
  };
};
