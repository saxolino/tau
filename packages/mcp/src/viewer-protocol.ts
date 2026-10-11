/**
 * The contract between `tau mcp` and the Tau viewer page.
 *
 * The page imports this module, so it holds names, shapes and pure helpers
 * only: no SDK, no zod and no Node built-ins.
 */

/** Tools the viewer page and its host entrypoints call. @public */
export const tauViewerToolName = {
  /** Show a project model in the viewer (the thread entrypoint). */
  showModel: 'show_model',
  /** Open one model file the host hands over (the file entrypoint). */
  openModelFile: 'open_model_file',
  /** List the project's renderable files (the global entrypoint). */
  browseModels: 'browse_models',
  /** Read a byte range of a shown model; only the page calls it. */
  appRead: 'app_read',
} as const;

/** Name of one viewer tool. @public */
export type TauViewerToolName = (typeof tauViewerToolName)[keyof typeof tauViewerToolName];

/** Largest byte range one `app_read` reply carries (blueprint D4). @public */
export const tauViewerReadLimit = 4 * 1024 * 1024;

/** The MCP Apps resource media type. @public */
export const tauViewerResourceMimeType = 'text/html;profile=mcp-app';

/** The client capability extension that marks an MCP Apps host. @public */
export const tauViewerUiExtension = 'io.modelcontextprotocol/ui';

/** Formats the page draws itself; every other format is converted by the server (blueprint D3). @public */
export const tauViewerMimeTypes = ['model/gltf-binary', 'image/svg+xml'] as const;

/** One format the page draws. @public */
export type TauViewerMimeType = (typeof tauViewerMimeTypes)[number];

/**
 * How `tau mcp` presents the viewer to one client (blueprint D5).
 *
 * - `inline`: an MCP Apps host; tools name the `ui://` page.
 * - `openai`: Codex desktop; the page plus OpenAI entrypoints (thread tab, sidebar, file handler).
 * - `text`: everything else; tools return a loopback link and screenshots.
 *
 * @public
 */
export type TauViewerPresentation = 'inline' | 'openai' | 'text';

/** One model the server prepared for the page. @public */
export type TauViewerModel = Readonly<{
  /** Opaque handle `app_read` takes; valid for the server process that issued it. */
  id: string;
  /** What the person sees as the model's name. */
  title: string;
  /** Project-relative path of the file the page draws (a source's rendered GLB lives under `.tau/artifacts`). */
  path: string;
  /** Project-relative CAD source the model was rendered from, when there is one. */
  sourceFile?: string | undefined;
  mimeType: TauViewerMimeType;
  byteLength: number;
  /** Hex SHA-256 of the bytes, so the page can tell a re-render from the model it already shows. */
  sha256: string;
}>;

/** Structured result of `show_model` and `open_model_file`. @public */
export type TauViewerShowResult = Readonly<{
  model: TauViewerModel;
  /** The loopback page showing this model, when the server runs one. */
  viewerUrl?: string | undefined;
}>;

/** One renderable file `browse_models` lists. @public */
export type TauViewerFile = Readonly<{
  path: string;
  title: string;
}>;

/** Structured result of `browse_models`. @public */
export type TauViewerBrowseResult = Readonly<{
  files: readonly TauViewerFile[];
}>;

/** Arguments of `app_read`. @public */
export type TauViewerReadInput = Readonly<{
  modelId: string;
  offset: number;
  length: number;
}>;

/** Structured result of `app_read`: one base64 slice of the model. @public */
export type TauViewerReadResult = Readonly<{
  offset: number;
  byteLength: number;
  totalBytes: number;
  /** The slice, base64-encoded. */
  data: string;
}>;

/** What `initialize` told the server about its client, as far as presentation is concerned. @public */
export type TauViewerClient = Readonly<{
  capabilities?:
    | Readonly<Record<string, unknown> & { extensions?: Readonly<Record<string, unknown>> | undefined }>
    | undefined;
  clientInfo?: Readonly<{ name: string }> | undefined;
}>;

/** The client name Codex's MCP client sends, from the desktop app and the CLI alike. */
const codexClientName = 'codex-mcp-client';

/**
 * Choose the presentation for one client (blueprint D5).
 *
 * The standard capability decides first: only a client declaring the MCP Apps
 * extension with the page's media type gets the page. Codex's desktop app
 * declares it and the Codex CLI does not, so the client name only chooses
 * OpenAI entrypoints over plain inline cards.
 *
 * @param client - The client's `initialize` capabilities and identity.
 * @returns The presentation to use for the session.
 * @public
 *
 * @example <caption>Codex desktop gets the entrypoints</caption>
 * ```typescript
 * import { resolveTauViewerPresentation } from '@taucad/mcp/viewer-protocol';
 *
 * resolveTauViewerPresentation({
 *   capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
 *   clientInfo: { name: 'codex-mcp-client' },
 * }); // 'openai'
 * ```
 */
export const resolveTauViewerPresentation = (client: TauViewerClient): TauViewerPresentation => {
  const extension = client.capabilities?.extensions?.[tauViewerUiExtension];
  const mimeTypes =
    typeof extension === 'object' && extension !== null && 'mimeTypes' in extension ? extension.mimeTypes : undefined;
  if (!Array.isArray(mimeTypes) || !mimeTypes.includes(tauViewerResourceMimeType)) {
    return 'text';
  }
  return client.clientInfo?.name === codexClientName ? 'openai' : 'inline';
};

/**
 * The `ui://` URI of one build of the page.
 *
 * Hosts cache a resource by its URI, so the URI carries the page's digest and
 * a new build is a new resource (blueprint D2).
 *
 * @param sha256 - Hex SHA-256 of the page's HTML.
 * @returns `ui://tau/<first 16 hex digits>/app.html`.
 * @public
 */
export const tauViewerResourceUri = (sha256: string): string => `ui://tau/${sha256.slice(0, 16)}/app.html`;
