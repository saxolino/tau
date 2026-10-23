import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { GraphicsBackendPreference } from '#graphics/graphics-settings.js';

/**
 * Developer and experimental switches the viewer reads. Each defaults to off.
 *
 * @public
 */
export type ViewerFeatures = {
  /** Diagnostic overlays, test bridges and console detail for renderer development. */
  readonly tauDebug: boolean;
  /** Mount the WebGPU inspector overlay on WebGPU canvases. */
  readonly webGpuInspector: boolean;
  /** Capture shader compilation stacks on WebGPU canvases. */
  readonly webGpuShaderStacks: boolean;
};

/**
 * The words of the viewer's bar, so an embedder can show them in its own language. Each defaults to English
 * ({@link defaultViewerLabels}); an embedder overrides any of them through {@link ViewerEnvironment.labels}.
 *
 * @public
 */
export type ViewerLabels = {
  /** The bar's controls group. */
  readonly viewerControls: string;
  /** Why a tool waits: there is no model on screen yet. */
  readonly unavailableWithoutModel: string;
  /** Fit view's name and tooltip. */
  readonly fitView: string;
  /** Fit view's visible label, shown from 520 px of viewer width. */
  readonly fitViewLabel: string;
  /** The tooltip right after fitting. */
  readonly viewFitted: string;
  /** Section's name. */
  readonly sectionView: string;
  /** Section's visible label. */
  readonly sectionLabel: string;
  /** Section's tooltip while it runs. */
  readonly stopSection: string;
  /** Measure's name. */
  readonly measure: string;
  /** Measure's visible label. */
  readonly measureLabel: string;
  /** Measure's tooltip while it runs. */
  readonly stopMeasure: string;
  /** The measuring row's name while Measure runs. */
  readonly measuring: string;
  /** A running tool's row name, from the tool's name. */
  readonly toolOptions: (toolName: string) => string;
  /** The button that ends a running tool. */
  readonly done: string;
  /** Its accessible name, from the tool's name. */
  readonly doneWith: (toolName: string) => string;
  /** Viewer settings' name and tooltip. */
  readonly viewerSettings: string;
  /** The grid readout's accessible name, from its size (`1 mm`). */
  readonly gridReadout: (size: string) => string;
  /** The grid readout's tooltip. */
  readonly gridTooltip: string;
  /** The grid menu's unit heading. */
  readonly unit: string;
  /** The grid menu's grid heading. */
  readonly grid: string;
  /** The grid menu's lock switch, from the grid size (`1 mm`). */
  readonly lockGridSize: (size: string) => string;
  /** The grid menu's hint. */
  readonly gridZoomHint: string;
};

/**
 * The viewer's own English words, used for any label an embedder leaves out.
 *
 * @public
 */
export const defaultViewerLabels: ViewerLabels = {
  viewerControls: 'Viewer controls',
  unavailableWithoutModel: 'Available when a model is displayed',
  fitView: 'Fit view',
  fitViewLabel: 'Fit',
  viewFitted: 'View fitted',
  sectionView: 'Section view',
  sectionLabel: 'Section',
  stopSection: 'Stop section',
  measure: 'Measure',
  measureLabel: 'Measure',
  stopMeasure: 'Stop measure',
  measuring: 'Measuring',
  toolOptions: (toolName) => `${toolName} options`,
  done: 'Done',
  doneWith: (toolName) => `Done with ${toolName.toLowerCase()}`,
  viewerSettings: 'Viewer settings',
  gridReadout: (size) => `Grid ${size}, units and grid`,
  gridTooltip: 'Change unit settings',
  unit: 'Unit',
  grid: 'Grid',
  lockGridSize: (size) => `Lock Grid Size (${size})`,
  gridZoomHint: 'Adjust grid size by changing zoom level',
};

/**
 * What the embedding application tells the viewer about its surroundings: the
 * colour scheme and accent it draws with, the graphics API it prefers and the
 * switches it enables. The viewer reads nothing from cookies, URLs or app
 * stores; an embedder maps its own theme and settings onto this value.
 *
 * @public
 */
export type ViewerEnvironment = {
  /** Light or dark rendering of grid, edges, lights and gizmo. */
  readonly colorScheme: 'light' | 'dark';
  /** Stronger grid and gizmo contrast for high-contrast themes. */
  readonly isHighContrast: boolean;
  /** The accent colour of the gizmo's active faces, as a CSS hex colour. */
  readonly accentColor: string;
  /** The graphics API to use when the device supports it; WebGL otherwise. */
  readonly graphicsBackend: GraphicsBackendPreference;
  /** Developer and experimental switches. */
  readonly features: ViewerFeatures;
  /**
   * Whether the canvas shows its render-loop FPS readout; on unless an
   * embedder that prints no status text (an MCP App card) turns it off.
   */
  readonly showRenderFps?: boolean | undefined;
  /**
   * Whether each WebGL frame stays in the canvas after it is shown, so the
   * embedder can read the live view (an MCP App's capture for the agent).
   * Off by default: keeping the buffer costs a copy per frame.
   */
  readonly readableCanvas?: boolean | undefined;
  /** The bar's words in the embedder's language; any left out stay in English. */
  readonly labels?: Partial<ViewerLabels> | undefined;
  /**
   * Whether the bar offers its Fullscreen button; on unless an embedder that
   * leaves fullscreen to the browser and the keyboard turns it off.
   */
  readonly showFullscreenControl?: boolean | undefined;
  /**
   * Debug-only component mounted inside the stage while `features.tauDebug` is
   * on; an application test bridge uses it to drive and observe the section view.
   */
  readonly debugStageBridge?: React.ComponentType<{ readonly isGeometryFramed: boolean }> | undefined;
};

/**
 * The environment a viewer uses when no {@link ViewerEnvironmentProvider} is
 * mounted: light, standard contrast, Tau's default accent, WebGL, no switches.
 *
 * @public
 */
export const defaultViewerEnvironment: ViewerEnvironment = {
  colorScheme: 'light',
  isHighContrast: false,
  accentColor: '#00987c',
  graphicsBackend: 'webgl',
  features: { tauDebug: false, webGpuInspector: false, webGpuShaderStacks: false },
};

const ViewerEnvironmentContext = createContext<ViewerEnvironment>(defaultViewerEnvironment);

/**
 * Provide the viewer's environment to every viewer below it.
 *
 * @param props - The environment and the viewer subtree.
 * @returns The provider.
 *
 * @public
 *
 * @example <caption>Follow a host's dark theme</caption>
 * ```tsx
 * import { ViewerEnvironmentProvider, defaultViewerEnvironment } from '@taucad/viewer/environment/viewer-environment';
 *
 * export const DarkViewer = ({ children }: { readonly children: React.ReactNode }): React.JSX.Element => (
 *   <ViewerEnvironmentProvider value={{ ...defaultViewerEnvironment, colorScheme: 'dark' }}>
 *     {children}
 *   </ViewerEnvironmentProvider>
 * );
 * ```
 */
export function ViewerEnvironmentProvider({
  value,
  children,
}: {
  readonly value: ViewerEnvironment;
  readonly children: ReactNode;
}): React.JSX.Element {
  return <ViewerEnvironmentContext.Provider value={value}>{children}</ViewerEnvironmentContext.Provider>;
}

/**
 * Read the nearest viewer environment, or {@link defaultViewerEnvironment}.
 *
 * @returns The environment.
 *
 * @public
 */
export function useViewerEnvironment(): ViewerEnvironment {
  return useContext(ViewerEnvironmentContext);
}

/**
 * Read the viewer bar's words: the embedder's, with English for any it leaves out.
 *
 * @returns Every word of the bar, in the embedder's language where it gave one.
 *
 * @public
 */
export function useViewerLabels(): ViewerLabels {
  const { labels } = useContext(ViewerEnvironmentContext);
  return useMemo(() => (labels === undefined ? defaultViewerLabels : { ...defaultViewerLabels, ...labels }), [labels]);
}

/**
 * Read one viewer switch.
 *
 * @param feature - The switch to read.
 * @returns Whether the switch is on.
 *
 * @public
 */
export function useViewerFeature(feature: keyof ViewerFeatures): boolean {
  return useContext(ViewerEnvironmentContext).features[feature];
}
