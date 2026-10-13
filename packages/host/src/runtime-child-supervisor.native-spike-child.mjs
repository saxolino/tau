/**
 * S35 spike child (native-dependency-resolution charter, D37). Not shipped.
 *
 * Forked by `startRuntimeChild` either under the standard permissioned profile (`--probe-only`, to report the
 * existing child's flags) or under the native-only profile, where it composes build123d and PicoGK from the sealed
 * producer trees in the store and serves them on loopback exactly as `host-runtime-child.ts` serves the CLI runtime.
 * Before `ready` it reports its `execArgv` and the `process.permission.has` answers as a `probe` frame.
 */
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'probe-only': { type: 'boolean' },
    'build123d-root': { type: 'string' },
    'picogk-root': { type: 'string' },
    'outside-path': { type: 'string', multiple: true },
  },
  strict: true,
});

/* As `sandbox-modules.ts` in the CLI: the runtime graph imports `sharp` eagerly but never calls it here. */
if (process.permission?.has('addon') === false) {
  registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === 'sharp'
        ? {
            url: `data:text/javascript,${encodeURIComponent('export default function sharp() { throw new Error("sharp is refused in the runtime child."); }')}`,
            format: 'module',
            shortCircuit: true,
          }
        : nextResolve(specifier, context),
  });
}

const has = (scope, reference) => {
  if (!process.permission) {
    return 'no-permission-model';
  }
  return reference === undefined ? process.permission.has(scope) : process.permission.has(scope, reference);
};

const probe = () => {
  const paths = {
    workspace: process.cwd(),
    temporary: tmpdir(),
    home: homedir(),
    build123dRoot: values['build123d-root'],
    picogkRoot: values['picogk-root'],
  };
  const outside = values['outside-path'] ?? [];
  return {
    type: 'probe',
    execArgv: process.execArgv,
    nodeVersion: process.version,
    paths,
    has: {
      child: has('child'),
      worker: has('worker'),
      addon: has('addon'),
      wasi: has('wasi'),
      'fs.read workspace': has('fs.read', paths.workspace),
      'fs.write workspace': has('fs.write', paths.workspace),
      'fs.read temporary': has('fs.read', paths.temporary),
      'fs.write temporary': has('fs.write', paths.temporary),
      'fs.read home': has('fs.read', paths.home),
      'fs.write home': has('fs.write', paths.home),
      ...(paths.build123dRoot
        ? {
            'fs.read build123d store': has('fs.read', paths.build123dRoot),
            'fs.write build123d store': has('fs.write', paths.build123dRoot),
          }
        : {}),
      ...(paths.picogkRoot
        ? {
            'fs.read picogk store': has('fs.read', paths.picogkRoot),
            'fs.write picogk store': has('fs.write', paths.picogkRoot),
          }
        : {}),
      ...Object.fromEntries(
        outside.flatMap((path) => [
          [`fs.read ${path}`, has('fs.read', path)],
          [`fs.write ${path}`, has('fs.write', path)],
        ]),
      ),
    },
  };
};

const readManifest = (root) => JSON.parse(readFileSync(resolve(root, 'tau-runtime-manifest.json'), 'utf8'));

const nativeRuntime = async () => {
  const [{ defineRuntime }, { build123d }, { picogk }] = await Promise.all([
    import('@taucad/runtime/worker'),
    import('../../plugins/build123d/src/index.ts'),
    import('../../plugins/picogk/src/index.ts'),
  ]);
  const plugins = [];
  const build123dRoot = values['build123d-root'];
  if (build123dRoot) {
    const manifest = readManifest(build123dRoot);
    plugins.push(
      build123d({
        kernels: {
          default: {
            pythonExecutable: resolve(build123dRoot, manifest.pythonRelativePath),
            workerPath: resolve(build123dRoot, manifest.workerPath),
            pythonSha256: manifest.pythonSha256,
            workerSha256: manifest.workerSha256,
            supportFiles: manifest.supportFiles.map(({ path, sha256 }) => ({ path: resolve(build123dRoot, path), sha256 })),
            requestTimeout: 120_000,
          },
        },
      }),
    );
  }
  const picogkRoot = values['picogk-root'];
  if (picogkRoot) {
    const manifest = readManifest(picogkRoot);
    plugins.push(
      picogk({
        kernels: {
          default: {
            workerExecutable: resolve(picogkRoot, manifest.workerPath),
            workerSha256: manifest.workerSha256,
            resourceFiles: manifest.resourceFiles.map(({ path, ...resource }) => ({
              ...resource,
              path: resolve(picogkRoot, path),
            })),
            requestTimeout: 120_000,
          },
        },
      }),
    );
  }
  return defineRuntime({ plugins });
};

let host;

const handle = async (message) => {
  if (message?.type === 'close') {
    await host?.close();
    host = undefined;
    if (process.connected) {
      process.disconnect();
    }
    return;
  }
  if (message?.type !== 'start' || typeof message.authorizationToken !== 'string') {
    return;
  }
  process.send?.(probe());
  if (values['probe-only']) {
    process.send?.({ type: 'ready', url: 'ws://127.0.0.1:9/', runtimeVersion: 'probe-only' });
    return;
  }
  const { serveHostRuntime } = await import(join(import.meta.dirname, 'runtime-host.ts'));
  host = await serveHostRuntime({ runtime: await nativeRuntime(), authorizationToken: message.authorizationToken });
  process.send?.({ type: 'ready', url: host.url.href, runtimeVersion: host.runtimeVersion });
};

let chain = Promise.resolve();
process.on('message', (message) => {
  chain = chain
    .then(async () => handle(message))
    .catch((error) => {
      process.exitCode = 1;
      if (process.connected) {
        process.send?.({ type: 'error', message: error instanceof Error ? `${error.message}\n${error.stack}` : String(error) });
        process.disconnect();
      }
    });
});
process.once('disconnect', () => {
  chain = chain.then(async () => host?.close());
});
