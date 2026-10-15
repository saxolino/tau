import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { startRuntimeChild } from '#runtime-child-supervisor.js';
import type { RuntimeChildWorker, RuntimeChildWorkerLaunch } from '#runtime-child-supervisor.js';

const proofSchema = z.object({
  filesystem: z.literal(true),
  childProcess: z.literal(true),
  worker: z.literal(true),
  workerExecArgvEscalation: z.literal(true),
  workerNodeOptionsEscalation: z.literal(true),
  addon: z.literal(true),
  wasi: z.literal(true),
  inspector: z.literal(true),
  temporaryDirectoryReadable: z.literal(true),
  temporaryDirectory: z.string(),
  environmentSecretAbsent: z.literal(true),
  network: z.literal(true),
  arbitraryNetworkAllowed: z.literal(true),
});

let temporaryDirectory: string | undefined;

afterEach(async () => {
  delete process.env['TAU_HOST_TEST_SECRET'];
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true });
    temporaryDirectory = undefined;
  }
});

describe('runtime child permission boundary', () => {
  it('denies host capabilities and every worker, strips secrets, reads back its own temp files, and pins unrestricted network egress', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'tau-host-permissions-'));
    const proofPath = join(temporaryDirectory, 'proof.json');
    const server = createServer((_request, response) => {
      response.end('ok');
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP permission-test server.');
    }
    process.env['TAU_HOST_TEST_SECRET'] = 'must-not-reach-child';
    const modulePath = fileURLToPath(new URL('fixtures/permission-proof-child.mjs', import.meta.url));

    const child = await startRuntimeChild({
      modulePath,
      args: [proofPath, `http://127.0.0.1:${String(address.port)}`],
    });
    const { temporaryDirectory: childTemporaryDirectory, ...proof } = proofSchema.parse(
      JSON.parse(await readFile(proofPath, 'utf8')),
    );

    expect(proof).toEqual({
      filesystem: true,
      childProcess: true,
      worker: true,
      workerExecArgvEscalation: true,
      workerNodeOptionsEscalation: true,
      addon: true,
      wasi: true,
      inspector: true,
      temporaryDirectoryReadable: true,
      environmentSecretAbsent: true,
      network: true,
      arbitraryNetworkAllowed: true,
    });
    expect(childTemporaryDirectory.startsWith(join(await realpath(tmpdir()), 'tau-runtime-child-'))).toBe(true);
    await child.close();
    await child.closed;
    await expect(access(childTemporaryDirectory)).rejects.toThrow(/ENOENT/u);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
});

describe('runtime child control frames', () => {
  it('delivers frames posted after the child is ready', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'tau-host-post-'));
    const outputPath = join(temporaryDirectory, 'messages.jsonl');
    const modulePath = fileURLToPath(new URL('fixtures/message-echo-child.mjs', import.meta.url));
    const child = await startRuntimeChild({ modulePath, args: [outputPath] });

    child.post({ type: 'zoo-proxy-credential', url: 'wss://api.example.test/v1/kernels/zoo', token: 'zt1.a.b' });
    child.post({ type: 'zoo-proxy-credential', url: 'wss://api.example.test/v1/kernels/zoo' });
    const readLines = async (): Promise<string[]> => {
      const text = await readFile(outputPath, 'utf8').catch(() => '');
      return text.trim().split('\n');
    };
    await expect.poll(async () => readLines()).toHaveLength(2);

    const lines = await readLines();
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { type: 'zoo-proxy-credential', url: 'wss://api.example.test/v1/kernels/zoo', token: 'zt1.a.b' },
      { type: 'zoo-proxy-credential', url: 'wss://api.example.test/v1/kernels/zoo' },
    ]);
    await child.close();
  });

  it('settles close only after closed, once the child has exited and its private directory is removed', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'tau-host-close-'));
    const modulePath = fileURLToPath(new URL('fixtures/message-echo-child.mjs', import.meta.url));
    const child = await startRuntimeChild({ modulePath, args: [join(temporaryDirectory, 'messages.jsonl')] });

    await child.close();

    /* No timer: an already-settled `closed` wins the race, and one still removing the directory loses it. */
    expect(await Promise.race([child.closed, Promise.resolve('pending')])).toEqual({ exitCode: 0 });
  });

  it('closes twice, without an uncaught error, a child whose channel disconnected before it exited', async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'tau-host-disconnect-'));
    const modulePath = fileURLToPath(new URL('fixtures/message-echo-child.mjs', import.meta.url));
    const child = await startRuntimeChild({ modulePath, args: [join(temporaryDirectory, 'messages.jsonl')] });
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown): void => {
      uncaught.push(error);
    };
    process.on('uncaughtException', onUncaught);
    try {
      child.post({ type: 'disconnect' });
      /* The child exits 500 ms after disconnecting; both closes land in between. */
      await delay(200);

      await Promise.all([child.close(), child.close()]);
      await delay(0);

      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });
});

describe('native workers brokered for a runtime child (D37, North Star S2)', () => {
  /** The flags `permissionArguments` gives a built child; native kernels add none. */
  const permissionFlags = (modulePath: string, childTemporaryDirectory: string): string[] => [
    '--permission',
    `--allow-fs-read=${process.cwd()}`,
    `--allow-fs-read=${dirname(modulePath)}`,
    `--allow-fs-read=${childTemporaryDirectory}`,
    `--allow-fs-write=${tmpdir()}`,
    `--allow-fs-write=${childTemporaryDirectory}`,
    ...(Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10) >= 26 ? ['--allow-net'] : []),
  ];

  const outcomeSchema = z.union([
    z.object({
      started: z.literal(true),
      stdout: z.string(),
      end: z.object({ exitCode: z.number().optional(), signal: z.string().optional() }),
    }),
    z.object({ started: z.literal(false), refusal: z.string() }),
  ]);
  const brokerProofSchema = z.object({
    execArgv: z.array(z.string()),
    childPermission: z.boolean(),
    ownSpawn: z.string(),
    native: z.unknown().optional(),
    outcomes: z.record(z.string(), outcomeSchema),
  });

  it('keeps the child flags and its spawn refusal, and starts a worker only from a sealed closure into the private directory of the child', async () => {
    temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'tau-host-broker-')));
    const proofPath = join(temporaryDirectory, 'proof.json');
    /* A sealed closure in the store, and an unsealed tree beside it holding the same worker. */
    const store = join(temporaryDirectory, 'store', 'closures', 'sha256');
    const sealed = join(store, 'a'.repeat(64));
    const unsealed = join(store, 'b'.repeat(64));
    const worker = '#!/bin/sh\necho worker ready\ncat\n';
    await Promise.all(
      [sealed, unsealed].map(async (root) => {
        await mkdir(root, { recursive: true });
        await writeFile(join(root, 'worker.sh'), worker);
        await chmod(join(root, 'worker.sh'), 0o755);
      }),
    );
    const sha256 = createHash('sha256').update(worker).digest('hex');
    const launchFrom = (root: string, overrides: Partial<RuntimeChildWorkerLaunch> = {}) => ({
      executablePath: join(root, 'worker.sh'),
      executableSha256: sha256,
      executableName: 'Fixture worker',
      arguments: [],
      runtimePath: root,
      resources: [],
      workspacePath: '<private>/workspace',
      artifactPath: '<private>/artifacts',
      commandId: 'Fixture#1',
      ...overrides,
    });
    const requests = [
      { name: 'sealed', launch: launchFrom(sealed) },
      { name: 'unsealed', launch: launchFrom(unsealed) },
      { name: 'escapedExecutable', launch: launchFrom(sealed, { executablePath: '/bin/sh' }) },
      { name: 'foreignWorkspace', launch: launchFrom(sealed, { workspacePath: temporaryDirectory }) },
    ];
    /* What `startNativeWorker` returns, minus the sandbox: this suite proves the brokering, not the containment. */
    const start = vi.fn(async (launch: RuntimeChildWorkerLaunch): Promise<RuntimeChildWorker> => {
      const process = spawn(launch.executablePath, [...launch.arguments], { stdio: 'pipe' });
      const ended = new Promise<Awaited<RuntimeChildWorker['ended']>>((resolve) => {
        process.once('exit', (code, signal) => {
          resolve({ ...(code === null ? {} : { exitCode: code }), ...(signal === null ? {} : { signal }) });
        });
      });
      return {
        stdin: process.stdin,
        stdout: process.stdout,
        stderr: process.stderr,
        ended,
        terminate: async () => {
          process.kill();
          await ended;
        },
      };
    });
    const modulePath = fileURLToPath(new URL('fixtures/native-broker-child.mjs', import.meta.url));

    const child = await startRuntimeChild({
      modulePath,
      args: [proofPath, JSON.stringify(requests)],
      native: {
        compose: async () => ({ unavailable: [], closureRoots: [sealed] }),
        closureRoots: async () => [sealed],
        start,
      },
    });
    const proof = brokerProofSchema.parse(JSON.parse(await readFile(proofPath, 'utf8')));
    const childTemporaryDirectory = proof.execArgv.at(3)?.slice('--allow-fs-read='.length) ?? '';
    await child.close();

    expect(proof.execArgv).toEqual(permissionFlags(modulePath, childTemporaryDirectory));
    expect(childTemporaryDirectory.startsWith(join(await realpath(tmpdir()), 'tau-runtime-child-'))).toBe(true);
    expect({ childPermission: proof.childPermission, ownSpawn: proof.ownSpawn }).toEqual({
      childPermission: false,
      ownSpawn: 'ERR_ACCESS_DENIED',
    });
    expect(proof.native).toEqual({ unavailable: [], closureRoots: [sealed] });
    expect(proof.outcomes['sealed']).toEqual({
      started: true,
      stdout: 'worker ready\nechoed through the daemon\n',
      end: { exitCode: 0 },
    });
    expect(proof.outcomes['unsealed']).toEqual({
      started: false,
      refusal: `Tau Host refused a native worker launch: ${unsealed} is not a closure sealed in the payload store.`,
    });
    expect(proof.outcomes['escapedExecutable']).toEqual({
      started: false,
      refusal: 'Tau Host refused a native worker launch: /bin/sh is outside the sealed closure.',
    });
    expect(proof.outcomes['foreignWorkspace']).toEqual({
      started: false,
      refusal: `Tau Host refused a native worker launch: ${temporaryDirectory} is not inside the runtime child's private directory.`,
    });
    expect(start).toHaveBeenCalledOnce();
    const [started] = start.mock.calls[0] ?? [];
    expect(started?.runtimePath).toBe(sealed);
    expect(started?.workspacePath).toMatch(/\/tau-runtime-child-[^/]+\/mirror-[^/]+\/workspace$/u);
  });

  it('hands a child no composition when the store cannot be read, and carries a failed start back as its refusal', async () => {
    temporaryDirectory = await realpath(await mkdtemp(join(tmpdir(), 'tau-host-broker-refused-')));
    const sealed = join(temporaryDirectory, 'closure');
    await mkdir(sealed);
    await writeFile(join(sealed, 'worker.sh'), '#!/bin/sh\n');
    const launch = {
      executablePath: join(sealed, 'worker.sh'),
      executableSha256: '0'.repeat(64),
      executableName: 'Fixture worker',
      arguments: [],
      runtimePath: sealed,
      resources: [],
      workspacePath: '<private>/workspace',
      artifactPath: '<private>/artifacts',
      commandId: 'Fixture#1',
    };
    const modulePath = fileURLToPath(new URL('fixtures/native-broker-child.mjs', import.meta.url));
    const refusedProof = join(temporaryDirectory, 'refused.json');
    const refused = await startRuntimeChild({
      modulePath,
      args: [refusedProof, JSON.stringify([{ name: 'refused', launch }])],
      native: {
        compose: async () => {
          throw new Error('the store cannot be read');
        },
        closureRoots: async () => [sealed],
        start: async () => {
          throw new Error('The native runtime is unavailable because its sandbox could not start: no bwrap.');
        },
      },
    });
    await refused.close();

    const refusedRun = brokerProofSchema.parse(JSON.parse(await readFile(refusedProof, 'utf8')));
    expect(refusedRun.native).toBeUndefined();
    expect(refusedRun.outcomes['refused']).toEqual({
      started: false,
      refusal: 'The native runtime is unavailable because its sandbox could not start: no bwrap.',
    });
  });
});
