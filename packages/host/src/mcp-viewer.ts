/**
 * The host half of the viewer `tau mcp` serves (agent plugin UI blueprint W4).
 *
 * `@taucad/mcp` registers the page and its tools; this module renders the
 * model a tool names into a GLB under `.tau/artifacts` (the runtime already
 * owns that path through `export_model`), hands out opaque handles the page
 * reads in ranges, and runs the loopback server a text host links to.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, extname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';

import type { TauMcpViewer, TauMcpViewerCallOptions, TauMcpViewerFailure } from '@taucad/mcp';
import { tauViewerReadLimit, tauViewerToolName } from '@taucad/mcp/viewer-protocol';
import type {
  TauViewerFile,
  TauViewerMimeType,
  TauViewerModel,
  TauViewerShowResult,
} from '@taucad/mcp/viewer-protocol';

/** The page's own formats by extension; every other file is a CAD source the runtime renders (blueprint D3). */
const drawnFormats: Readonly<Record<string, TauViewerMimeType>> = {
  '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml',
};

/** Extensions `browse_models` lists as CAD sources. */
const sourceExtensions = new Set(['.ts', '.js', '.mjs', '.jsx', '.tsx', '.scad', '.py', '.kcl']);

/** Folders `browse_models` never enters. */
const skippedFolders = new Set(['node_modules', '.git', '.tau', 'dist', 'build', 'out', '.venv', '__pycache__']);

/** Files `browse_models` lists at most, so a large checkout answers quickly. */
const browseLimit = 200;

/** Folders deep `browse_models` looks. */
const browseDepth = 6;

/** What {@link createLocalMcpViewer} needs from the server that hosts it. */
export type LocalMcpViewerOptions = Readonly<{
  /** The single-file page and its digest. */
  page: Readonly<{ html: string; sha256: string }>;
  /** The project folder one call works in. */
  rootOf(meta: Readonly<Record<string, unknown>> | undefined): string;
  /**
   * Render one CAD source to GLB under `.tau/artifacts` through the registry's `export_model`.
   *
   * @returns The project-relative artifact path, or a failure.
   */
  renderGlb(
    input: Readonly<{ root: string; targetFile: string; toolCallId: string; signal?: AbortSignal | undefined }>,
  ): Promise<string | TauMcpViewerFailure>;
}>;

/** A viewer port plus the loopback server it may have started. */
export type LocalMcpViewer = TauMcpViewer &
  Readonly<{
    /** Stop the loopback server, if one runs. */
    close(): Promise<void>;
  }>;

type Shown = Readonly<{ model: TauViewerModel; absolutePath: string }>;

const failure = (errorCode: string, message: string): TauMcpViewerFailure => ({ errorCode, message });

const isFailure = (value: unknown): value is TauMcpViewerFailure =>
  typeof value === 'object' && value !== null && 'errorCode' in value;

/**
 * A path inside `root`, or `undefined` when it leaves it.
 *
 * @param root - The project folder.
 * @param path - Project-relative or absolute.
 * @returns The absolute path.
 */
const inside = (root: string, path: string): string | undefined => {
  const absolute = isAbsolute(path) ? resolvePath(path) : resolvePath(root, path);
  const fromRoot = relative(root, absolute);
  return fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot) ? undefined : absolute;
};

/** POSIX separators, as every project path on the wire uses. */
const posix = (path: string): string => path.split(sep).join('/');

/**
 * The entry file the project's `tau.json` names, if any.
 *
 * @param root - The project folder.
 * @returns Its project-relative path.
 */
const mainEntry = async (root: string): Promise<string | undefined> => {
  try {
    const manifest: unknown = JSON.parse(await readFile(join(root, 'tau.json'), 'utf8'));
    const entryPath =
      typeof manifest === 'object' && manifest !== null && 'assets' in manifest
        ? (manifest as Readonly<{ assets?: Readonly<{ main?: Readonly<{ entryPath?: unknown }> }> }>).assets?.main
            ?.entryPath
        : undefined;
    return typeof entryPath === 'string' && entryPath !== '' ? entryPath : undefined;
  } catch {
    return undefined;
  }
};

/**
 * List renderable files under `root`, shallowest first.
 *
 * @param root - The project folder.
 * @returns Up to {@link browseLimit} project-relative paths.
 */
const renderableFiles = async (root: string): Promise<string[]> => {
  const found: string[] = [];
  let level = [root];
  for (let depth = 0; depth < browseDepth && level.length > 0 && found.length < browseLimit; depth += 1) {
    const next: string[] = [];
    for (const folder of level) {
      // ponytail: an unreadable folder lists nothing rather than failing the whole list.
      // oxlint-disable-next-line no-await-in-loop -- breadth-first and bounded: a level is read before the next.
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) {
          if (!skippedFolders.has(entry.name) && !entry.name.startsWith('.')) {
            next.push(path);
          }
          continue;
        }
        const extension = extname(entry.name).toLowerCase();
        const isSource =
          sourceExtensions.has(extension) && !/\.(?:test|spec|d|config|geospec)\.[a-z]+$/u.test(entry.name);
        if (entry.isFile() && (isSource || extension in drawnFormats)) {
          found.push(posix(relative(root, path)));
          if (found.length >= browseLimit) {
            return found;
          }
        }
      }
    }
    level = next;
  }
  return found;
};

/** The title a file shows under: its name without the extension. */
const titleOf = (path: string): string => basename(path, extname(path));

/**
 * Compare two secrets without leaking their common prefix through timing.
 *
 * @param expected - The secret.
 * @param actual - What the caller sent.
 * @returns Whether they match.
 */
const sameSecret = (expected: string, actual: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Request bodies the loopback API accepts at most. */
const loopbackBodyLimit = 64 * 1024;

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Array<Uint8Array<ArrayBuffer>> = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > loopbackBodyLimit) {
      throw new Error('Request body too large.');
    }
    chunks.push(new Uint8Array(buffer));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

/**
 * The loopback page's response headers: the same no-origin policy a host
 * sandbox applies (blueprint I2), plus `connect-src 'self'` for the API the
 * page reaches its tools through.
 */
const pageHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'self' data: blob:",
    'worker-src blob:',
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

/**
 * Create the viewer port `serveLocalHostMcp` hands to `@taucad/mcp`.
 *
 * @param options - The page, how to find the project folder, and how to render a source.
 * @returns The port and its cleanup.
 */
export const createLocalMcpViewer = (options: LocalMcpViewerOptions): LocalMcpViewer => {
  const shown = new Map<string, Shown>();
  const lastShown = new Map<string, string>();
  const token = randomBytes(24).toString('base64url');
  let loopback: Promise<{ server: Server; origin: string }> | undefined;

  const describe = async (
    root: string,
    absolutePath: string,
    sourceFile: string | undefined,
  ): Promise<TauViewerShowResult['model'] | TauMcpViewerFailure> => {
    const mimeType = drawnFormats[extname(absolutePath).toLowerCase()];
    if (mimeType === undefined) {
      return failure(
        'UNSUPPORTED_FORMAT',
        `The Tau viewer draws GLB and SVG; ${posix(relative(root, absolutePath))} is neither.`,
      );
    }
    const bytes = await readFile(absolutePath).catch(() => undefined);
    if (bytes === undefined) {
      return failure('NOT_FOUND', `${posix(relative(root, absolutePath))} could not be read.`);
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const id = createHash('sha256').update(`${absolutePath}\0${sha256}`).digest('base64url').slice(0, 22);
    const path = posix(relative(root, absolutePath));
    const model: TauViewerModel = {
      id,
      title: titleOf(sourceFile ?? path),
      path,
      ...(sourceFile === undefined ? {} : { sourceFile }),
      mimeType,
      byteLength: bytes.length,
      sha256,
    };
    shown.set(id, { model, absolutePath });
    return model;
  };

  const startLoopback = async (): Promise<{ server: Server; origin: string }> => {
    const server = createServer((request, response) => {
      void handleLoopback(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.unref();
    const { port } = server.address() as AddressInfo;
    return { server, origin: `http://127.0.0.1:${String(port)}` };
  };

  /* A text host gets a link; when the loopback server cannot start, the model
   * is still shown without one, and the next text show tries again. */
  const viewerUrl = async (model: TauViewerModel, presentation: TauMcpViewerCallOptions['presentation']) => {
    if (presentation !== 'text') {
      return undefined;
    }
    loopback ??= startLoopback();
    const starting = loopback;
    try {
      const { origin } = await starting;
      return `${origin}/?model=${encodeURIComponent(model.id)}#${token}`;
    } catch {
      if (loopback === starting) {
        loopback = undefined;
      }
      return undefined;
    }
  };

  const showPath = async (
    root: string,
    path: string,
    callOptions: TauMcpViewerCallOptions,
  ): Promise<TauViewerShowResult | TauMcpViewerFailure> => {
    const absolute = inside(root, path);
    if (absolute === undefined) {
      return failure('PATH_OUTSIDE_PROJECT', `${path} is outside the project ${root}.`);
    }
    const relativePath = posix(relative(root, absolute));
    const isDrawn = extname(absolute).toLowerCase() in drawnFormats;
    let model: TauViewerModel | TauMcpViewerFailure;
    if (isDrawn) {
      model = await describe(root, absolute, undefined);
    } else {
      const exists = await stat(absolute).then(
        (stats) => stats.isFile(),
        () => false,
      );
      if (!exists) {
        return failure('NOT_FOUND', `${relativePath} does not exist in ${root}.`);
      }
      const artifact = await options.renderGlb({
        root,
        targetFile: relativePath,
        toolCallId: callOptions.toolCallId,
        signal: callOptions.signal,
      });
      if (isFailure(artifact)) {
        return artifact;
      }
      const artifactPath = inside(root, artifact);
      model =
        artifactPath === undefined
          ? failure('RENDER_FAILED', `The rendered model for ${relativePath} landed outside the project.`)
          : await describe(root, artifactPath, relativePath);
    }
    if (isFailure(model)) {
      return model;
    }
    lastShown.set(root, model.sourceFile ?? model.path);
    const url = await viewerUrl(model, callOptions.presentation);
    return { model, ...(url === undefined ? {} : { viewerUrl: url }) };
  };

  const port: LocalMcpViewer = {
    page: options.page,
    async show(input, callOptions) {
      const root = options.rootOf(callOptions.meta);
      const target = input.targetFile ?? lastShown.get(root) ?? (await mainEntry(root));
      if (target === undefined) {
        return failure(
          'NO_TARGET',
          `Name the file to show: ${root} has no model shown yet and its tau.json names no main entry.`,
        );
      }
      return showPath(root, target, callOptions);
    },
    async open(input, callOptions) {
      return showPath(options.rootOf(callOptions.meta), input.path, callOptions);
    },
    async browse(callOptions) {
      const root = options.rootOf(callOptions.meta);
      const main = await mainEntry(root);
      const paths = await renderableFiles(root);
      const ordered =
        main !== undefined && paths.includes(main) ? [main, ...paths.filter((path) => path !== main)] : paths;
      const files: TauViewerFile[] = ordered.map((path) => ({ path, title: titleOf(path) }));
      return { files };
    },
    async read(input) {
      const entry = shown.get(input.modelId);
      if (entry === undefined) {
        return failure('UNKNOWN_MODEL', 'This model is no longer shown; show it again.');
      }
      const bytes = await readFile(entry.absolutePath).catch(() => undefined);
      if (bytes === undefined || createHash('sha256').update(bytes).digest('hex') !== entry.model.sha256) {
        return failure('MODEL_CHANGED', `${entry.model.path} changed since it was shown; show it again.`);
      }
      const offset = Math.min(input.offset, bytes.length);
      const slice = bytes.subarray(offset, Math.min(offset + Math.min(input.length, tauViewerReadLimit), bytes.length));
      return { offset, byteLength: slice.length, totalBytes: bytes.length, data: slice.toString('base64') };
    },
    async close() {
      const running = loopback;
      loopback = undefined;
      /* A start that failed left nothing to stop. */
      const server = await running?.then(
        (started) => started.server,
        () => undefined,
      );
      if (server !== undefined) {
        await new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
          server.closeAllConnections();
        });
      }
    },
  };

  /* The loopback API runs the same port functions a host would reach through
   * `tools/call`, for the page served at `/`. The token rides the URL fragment,
   * which the browser never sends, and the page returns it in a header. */
  const loopbackTools: Readonly<Record<string, (args: Record<string, unknown>) => Promise<unknown>>> = {
    [tauViewerToolName.appRead]: async (args) =>
      port.read(
        { modelId: String(args['modelId']), offset: Number(args['offset']), length: Number(args['length']) },
        { toolCallId: 'loopback', presentation: 'text' },
      ),
    [tauViewerToolName.showModel]: async (args) =>
      port.show(
        { targetFile: typeof args['targetFile'] === 'string' ? args['targetFile'] : undefined },
        { toolCallId: 'loopback', presentation: 'text' },
      ),
    [tauViewerToolName.browseModels]: async () => port.browse({ toolCallId: 'loopback', presentation: 'text' }),
  };

  const handleLoopback = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    /* Only a page this server served may call it: a rebound DNS name reaches
     * the same socket under another Host. */
    if (!/^127\.0\.0\.1:\d+$/u.test(request.headers.host ?? '')) {
      response.writeHead(421, { 'content-type': 'text/plain' }).end('Misdirected request');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, pageHeaders).end(options.page.html);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/tools/call') {
      const sent = request.headers['x-tau-viewer-token'];
      if (typeof sent !== 'string' || !sameSecret(token, sent)) {
        response.writeHead(403, { 'content-type': 'application/json' }).end('{"errorCode":"FORBIDDEN"}');
        return;
      }
      try {
        const body = await readBody(request);
        const call = typeof body === 'object' && body !== null ? (body as { name?: unknown; arguments?: unknown }) : {};
        const tool = typeof call.name === 'string' ? loopbackTools[call.name] : undefined;
        if (tool === undefined) {
          response.writeHead(404, { 'content-type': 'application/json' }).end('{"errorCode":"UNKNOWN_TOOL"}');
          return;
        }
        const args =
          typeof call.arguments === 'object' && call.arguments !== null
            ? (call.arguments as Record<string, unknown>)
            : {};
        const result = await tool(args);
        response
          .writeHead(isFailure(result) ? 422 : 200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          .end(JSON.stringify(result));
      } catch (error) {
        response.writeHead(400, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            errorCode: 'BAD_REQUEST',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  };

  return port;
};
