import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import {
  resolveTauViewerPresentation,
  tauViewerReadLimit,
  tauViewerResourceMimeType,
  tauViewerResourceUri,
  tauViewerToolName,
} from '#viewer-protocol.js';
import type {
  TauViewerBrowseResult,
  TauViewerPresentation,
  TauViewerReadInput,
  TauViewerReadResult,
  TauViewerShowResult,
} from '#viewer-protocol.js';

/** A failure a viewer port returns instead of throwing. @public */
export type TauMcpViewerFailure = Readonly<{ errorCode: string; message: string }>;

/** Per-call context a viewer port receives. @public */
export type TauMcpViewerCallOptions = Readonly<{
  /** Stable identifier of this tool call. */
  toolCallId: string;
  /** Cancels the call. */
  signal?: AbortSignal | undefined;
  /** The client's request `_meta`, verbatim (Codex names the thread's folder and an opened file here). */
  meta?: Readonly<Record<string, unknown>> | undefined;
  /** How this session presents the viewer; a `text` session needs a loopback `viewerUrl`. */
  presentation: TauViewerPresentation;
}>;

/**
 * What the host supplies for `tau mcp` to serve the viewer page.
 *
 * `@taucad/mcp` owns no filesystem: the host renders and reads models, and
 * runs the loopback server a `text` session links to.
 *
 * @public
 */
export type TauMcpViewer = Readonly<{
  /** The single-file page and the digest that names its `ui://` URI. */
  page: Readonly<{ html: string; sha256: string }>;
  /** Render or locate a model to show; without a target, the model shown last or the project's main file. */
  show(
    input: Readonly<{ targetFile?: string | undefined }>,
    options: TauMcpViewerCallOptions,
  ): Promise<TauViewerShowResult | TauMcpViewerFailure>;
  /** Show one project file a host entrypoint opened. */
  open(
    input: Readonly<{ path: string }>,
    options: TauMcpViewerCallOptions,
  ): Promise<TauViewerShowResult | TauMcpViewerFailure>;
  /** List the project's renderable files. */
  browse(options: TauMcpViewerCallOptions): Promise<TauViewerBrowseResult | TauMcpViewerFailure>;
  /** Read one byte range of a model `show` or `open` returned. */
  read(input: TauViewerReadInput, options: TauMcpViewerCallOptions): Promise<TauViewerReadResult | TauMcpViewerFailure>;
}>;

const descriptions = {
  showModel:
    'Show a CAD source file (targetFile), or a GLB or SVG file, in the Tau viewer the person sees; omit targetFile to show the model shown last or the project main file. Call it after evaluate_model succeeds when the person should look at the result.',
  openModelFile:
    'Open one project model file in the Tau viewer. The host calls this when the person opens a file with Tau.',
  browseModels: "List the project's renderable model files for the Tau viewer's file list.",
  appRead: 'Read a byte range of a model the Tau viewer shows. Only the viewer page calls this.',
} as const;

const showModelInputSchema = z
  .object({
    targetFile: z.string().min(1).optional().describe('Project-relative CAD source, GLB or SVG file to show.'),
  })
  .strict();

const openModelFileInputSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .optional()
      .describe('Project-relative or absolute path of the file to open; a file entrypoint supplies it in _meta.'),
  })
  .strict();

const appReadInputSchema = z
  .object({
    modelId: z.string().min(1),
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(tauViewerReadLimit),
  })
  .strict();

/** The file extensions the file entrypoint claims; other formats wait for server-side conversion (W7). */
const fileEntrypointExtensions = ['glb', 'svg'];

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const isFailure = (value: Readonly<Record<string, unknown>>): value is TauMcpViewerFailure => 'errorCode' in value;

const failure = ({ errorCode, message }: TauMcpViewerFailure): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: `${errorCode}: ${message}` }],
});

const shown = (result: TauViewerShowResult, presentation: TauViewerPresentation): CallToolResult => {
  const { model, viewerUrl } = result;
  const name = model.sourceFile ?? model.path;
  const text =
    presentation === 'text'
      ? viewerUrl === undefined
        ? `Rendered ${name} for the Tau viewer, but this session runs no viewer page. Use screenshot to look at it.`
        : `Open ${name} in the Tau viewer: ${viewerUrl}`
      : `Showing ${name} in the Tau viewer.`;
  return { content: [{ type: 'text', text }], structuredContent: result };
};

/**
 * The path a Codex file entrypoint names in `_meta["openai/resource"]`.
 *
 * @param meta - The request's `_meta`.
 * @returns The path, or `undefined`.
 */
const openedPath = (meta: Readonly<Record<string, unknown>> | undefined): string | undefined => {
  const resource = meta?.['openai/resource'];
  const path = typeof resource === 'object' && resource !== null && 'path' in resource ? resource.path : undefined;
  return typeof path === 'string' && path !== '' ? path : undefined;
};

/**
 * Register the viewer page and its tools on one server.
 *
 * Everything is registered before `initialize`; once the client has said who it
 * is, the presentation (blueprint D5) decides which tools are listed and what
 * `_meta` names the page. The client sends no request between `initialize` and
 * its `initialized` notification, so the change needs no list-changed notice.
 *
 * @param server - The MCP server.
 * @param viewer - The host's viewer port.
 * @param alwaysLoad - `_meta` every Tau tool carries.
 * @returns Nothing.
 * @public
 */
export const registerTauMcpViewer = (
  server: McpServer,
  viewer: TauMcpViewer,
  alwaysLoad: Readonly<Record<string, unknown>>,
): void => {
  const resourceUri = tauViewerResourceUri(viewer.page.sha256);
  let presentation: TauViewerPresentation = 'text';
  const callOptions = (extra: {
    signal: AbortSignal;
    _meta?: Record<string, unknown> | undefined;
    requestId: string | number;
  }): TauMcpViewerCallOptions => ({
    toolCallId: String(extra.requestId),
    signal: extra.signal,
    meta: extra._meta,
    presentation,
  });

  /* The page needs no origin at all: its bytes travel through `app_read`
   * (blueprint D4, I2), so the CSP lists only `data:` (inlined wasm) and
   * `blob:` (inlined workers, decoded models). Copy prompt writes the clipboard. */
  const resourceMeta = {
    ui: {
      csp: { connectDomains: ['data:', 'blob:'], resourceDomains: ['data:', 'blob:'] },
      permissions: { clipboardWrite: {} },
      prefersBorder: true,
    },
  };
  server.registerResource(
    'tau-viewer',
    resourceUri,
    {
      title: 'Tau viewer',
      description: 'The Tau CAD viewer page.',
      mimeType: tauViewerResourceMimeType,
      _meta: resourceMeta,
    },
    async () => ({
      contents: [
        { uri: resourceUri, mimeType: tauViewerResourceMimeType, text: viewer.page.html, _meta: resourceMeta },
      ],
    }),
  );

  const showModel = server.registerTool(
    tauViewerToolName.showModel,
    {
      description: descriptions.showModel,
      inputSchema: showModelInputSchema,
      annotations: readOnlyAnnotations,
      _meta: alwaysLoad,
    },
    async (args, extra) => {
      const result = await viewer.show({ targetFile: args.targetFile }, callOptions(extra));
      return isFailure(result) ? failure(result) : shown(result, presentation);
    },
  );
  const openModelFile = server.registerTool(
    tauViewerToolName.openModelFile,
    {
      description: descriptions.openModelFile,
      inputSchema: openModelFileInputSchema,
      annotations: readOnlyAnnotations,
      _meta: alwaysLoad,
    },
    async (args, extra) => {
      const path = openedPath(extra._meta) ?? args.path;
      if (path === undefined) {
        return failure({ errorCode: 'INVALID_INPUT', message: 'open_model_file needs a path.' });
      }
      const result = await viewer.open({ path }, callOptions(extra));
      return isFailure(result) ? failure(result) : shown(result, presentation);
    },
  );
  const browseModels = server.registerTool(
    tauViewerToolName.browseModels,
    { description: descriptions.browseModels, annotations: readOnlyAnnotations, _meta: alwaysLoad },
    async (extra) => {
      const result = await viewer.browse(callOptions(extra));
      if (isFailure(result)) {
        return failure(result);
      }
      return {
        content: [{ type: 'text', text: result.files.map((file) => file.path).join('\n') || 'No renderable files.' }],
        structuredContent: result,
      };
    },
  );
  const appRead = server.registerTool(
    tauViewerToolName.appRead,
    {
      description: descriptions.appRead,
      inputSchema: appReadInputSchema,
      annotations: readOnlyAnnotations,
      _meta: alwaysLoad,
    },
    async (args, extra) => {
      const result = await viewer.read(args, callOptions(extra));
      if (isFailure(result)) {
        return failure(result);
      }
      return {
        content: [
          {
            type: 'text',
            text: `Bytes ${String(result.offset)}+${String(result.byteLength)} of ${String(result.totalBytes)}.`,
          },
        ],
        structuredContent: result,
      };
    },
  );

  const pageMeta = (entrypoint?: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
    ...alwaysLoad,
    ui: { resourceUri },
    'ui/resourceUri': resourceUri,
    ...(presentation === 'openai'
      ? { 'openai/outputTemplate': resourceUri, ...(entrypoint ? { 'openai/ui': { entrypoints: [entrypoint] } } : {}) }
      : {}),
  });
  const present = (tool: RegisteredTool, enabled: boolean, meta: Record<string, unknown>): void => {
    /* Assigned, not `update()`d: `update` sends a list-changed notice, and the
     * client has not finished initializing. */
    tool.enabled = enabled;
    tool._meta = meta;
  };
  const applyPresentation = (): void => {
    const hasPage = presentation !== 'text';
    present(showModel, true, hasPage ? pageMeta({ type: 'thread' }) : { ...alwaysLoad });
    present(openModelFile, presentation === 'openai', pageMeta({ type: 'file', extensions: fileEntrypointExtensions }));
    present(browseModels, presentation === 'openai', pageMeta({ type: 'global' }));
    present(appRead, hasPage, { ...alwaysLoad, ui: { resourceUri, visibility: ['app'] } });
  };
  applyPresentation();

  const previous = server.server.oninitialized;
  server.server.oninitialized = () => {
    presentation = resolveTauViewerPresentation({
      capabilities: server.server.getClientCapabilities(),
      clientInfo: server.server.getClientVersion(),
    });
    applyPresentation();
    previous?.();
  };
};
