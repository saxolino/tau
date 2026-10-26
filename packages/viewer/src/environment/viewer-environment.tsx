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
  /** The words of the measuring row and its list. */
  readonly measurement: MeasurementLabels;
  /** The words of the view settings menu. */
  readonly settings: SettingsLabels;
};

/**
 * The words of the viewer settings menu (English by default).
 *
 * @public
 */
export type SettingsLabels = {
  readonly model: string;
  readonly surfaces: string;
  readonly lines: string;
  readonly matcap: string;
  readonly matcapInfo: string;
  readonly lightingActive: string;
  readonly lightingInactive: string;
  readonly postProcessing: string;
  readonly postProcessingInfo: string;
  readonly occlusionActive: string;
  readonly occlusionInactive: string;
  readonly viewport: string;
  readonly gizmo: string;
  readonly grid: string;
  readonly axes: string;
  readonly upDirection: string;
  readonly upAria: (axis: string) => string;
  readonly orthographic: string;
  readonly fieldOfView: string;
  readonly fieldOfViewAria: string;
  readonly fieldOfViewDrag: string;
  readonly fieldOfViewKeys: string;
  readonly rendering: string;
  readonly renderTimeout: string;
  readonly timeoutInfo: string;
  readonly timeoutDisabled: string;
  readonly kernelSettings: string;
  readonly kernelDefaults: string;
  readonly kernelChanged: (count: number) => string;
  readonly kernelReset: string;
  readonly kernelPreset: string;
  readonly kernelCustom: string;
  readonly kernelModeOf: (label: string) => string;
  readonly kernelPresetOf: (label: string) => string;
  readonly seconds: (count: number) => string;
  readonly minutes: (count: number) => string;
};

/**
 * The words of the Measure tool, so an embedder can show them in its own language (English by default).
 *
 * @public
 */
export type MeasurementLabels = {
  readonly operations: Readonly<
    Record<
      | 'point-distance'
      | 'minimum-distance'
      | 'center-distance'
      | 'plane-spacing'
      | 'edge-length'
      | 'radius'
      | 'diameter'
      | 'angle'
      | 'extent-x'
      | 'extent-y'
      | 'extent-z',
      string
    >
  >;
  readonly qualities: Readonly<Record<'mesh' | 'fitted' | 'cad' | 'snapshot', string>>;
  readonly list: string;
  readonly resolving: string;
  readonly unavailable: string;
  readonly outOfDate: string;
  readonly pending: string;
  readonly rootFrame: string;
  readonly featureFrame: string;
  readonly evidenceFor: (label: string) => string;
  readonly noEvidence: string;
  readonly summary: (operation: string, label: string, isOutOfDate: boolean) => string;
  readonly pin: (label: string) => string;
  readonly copyFull: (label: string) => string;
  readonly remove: (label: string) => string;
  readonly chooseHint: string;
  readonly clickTwoPoints: string;
  readonly count: (count: number) => string;
  readonly targets: (mode: string, filter: string) => string;
  readonly modeAuto: string;
  readonly modePoints: string;
  readonly filterAll: string;
  readonly filters: Readonly<Record<'point' | 'edge' | 'face' | 'circle' | 'body', string>>;
  readonly targetsName: string;
  readonly mode: string;
  readonly modeName: string;
  readonly snapOn: string;
  readonly snapOff: string;
  readonly snapTurnOff: string;
  readonly snapTurnOn: string;
  readonly filter: string;
  readonly filterName: string;
  readonly operation: string;
  readonly operationName: string;
  readonly frame: string;
  readonly frameName: string;
  readonly frameRoot: string;
  readonly frameLocal: string;
  readonly chooseTarget: string;
  readonly selectTarget: string;
  readonly loadMore: string;
  readonly lock: string;
  readonly unlock: string;
  readonly useTarget: string;
  readonly clearAll: string;
  readonly locked: string;
  readonly previewName: string;
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
  settings: {
    model: 'Model',
    surfaces: 'Surfaces',
    lines: 'Lines',
    matcap: 'Matcap',
    matcapInfo:
      'A material that gives models a consistent appearance independent of scene lighting. Rendering performance is improved with this enabled.',
    lightingActive: 'Lighting effects are active',
    lightingInactive: 'Lighting effects are inactive',
    postProcessing: 'Post-processing',
    postProcessingInfo: 'Enables screen-space ambient occlusion for more realistic depth and contact shadows.',
    occlusionActive: 'Ambient occlusion is active',
    occlusionInactive: 'Ambient occlusion is inactive',
    viewport: 'Viewport',
    gizmo: 'Gizmo',
    grid: 'Grid',
    axes: 'Axes',
    upDirection: 'Up Direction',
    upAria: (axis) => `${axis}-up`,
    orthographic: 'Orthographic',
    fieldOfView: 'Field of view',
    fieldOfViewAria: 'Field of view, 0° is orthographic',
    fieldOfViewDrag: 'Drag for field of view · 0° is orthographic',
    fieldOfViewKeys: 'Click or Enter to type · ←→ step 1° · Shift 5° · P toggles orthographic',
    rendering: 'Rendering',
    renderTimeout: 'Timeout',
    timeoutInfo: 'Maximum time to wait for CAD rendering before timing out. Set to "Disabled" to turn off timeout.',
    timeoutDisabled: 'Disabled',
    kernelSettings: 'Kernel settings',
    kernelDefaults: 'Using kernel defaults',
    kernelChanged: (count) => `${count} changed from ${count === 1 ? 'its default' : 'defaults'}`,
    kernelReset: 'Reset to defaults',
    kernelPreset: 'Preset',
    kernelCustom: 'Custom',
    kernelModeOf: (label) => `${label} mode`,
    kernelPresetOf: (label) => `${label} preset`,
    seconds: (count) => `${count}s`,
    minutes: (count) => `${count} min`,
  },
  measurement: {
    operations: {
      'point-distance': 'Point distance',
      'minimum-distance': 'Minimum distance',
      'center-distance': 'Center distance',
      'plane-spacing': 'Plane spacing',
      'edge-length': 'Edge length',
      radius: 'Radius',
      diameter: 'Diameter',
      angle: 'Angle',
      'extent-x': 'X extent',
      'extent-y': 'Y extent',
      'extent-z': 'Z extent',
    },
    qualities: { mesh: 'Mesh', fitted: 'Fitted', cad: 'CAD geometry', snapshot: 'Snapshot' },
    list: 'Measurements',
    resolving: 'Resolving distance',
    unavailable: 'Distance unavailable',
    outOfDate: 'Out of date',
    pending: 'Pending',
    rootFrame: 'Root frame',
    featureFrame: 'Selected feature frame',
    evidenceFor: (label) => `Measurement source and accuracy for ${label}`,
    noEvidence: 'Source accuracy information is unavailable.',
    summary: (operation, label, isOutOfDate) => `${operation}: ${label}${isOutOfDate ? ', out of date' : ''}`,
    pin: (label) => `Pin ${label}`,
    copyFull: (label) => `Copy full precision for ${label}`,
    remove: (label) => `Remove ${label}`,
    chooseHint: 'Choose a feature or two points',
    clickTwoPoints: 'Click two points',
    count: (count) => `${count} ${count === 1 ? 'measurement' : 'measurements'}`,
    targets: (mode, filter) => `Targets: ${mode} · ${filter}`,
    modeAuto: 'Auto',
    modePoints: 'Points',
    filterAll: 'All',
    filters: { point: 'Points', edge: 'Edges', face: 'Faces', circle: 'Circles', body: 'Bodies' },
    targetsName: 'Measurement targets',
    mode: 'Mode',
    modeName: 'Measurement mode',
    snapOn: 'Snap on',
    snapOff: 'Snap off',
    snapTurnOff: 'Turn snapping off',
    snapTurnOn: 'Turn snapping on',
    filter: 'Filter',
    filterName: 'Feature filter',
    operation: 'Operation',
    operationName: 'Measurement operation',
    frame: 'Frame',
    frameName: 'Measurement frame',
    frameRoot: 'Root',
    frameLocal: 'Selected feature local',
    chooseTarget: 'Choose target',
    selectTarget: 'Select a visible target',
    loadMore: 'Load more targets',
    lock: 'Lock target',
    unlock: 'Unlock target',
    useTarget: 'Use target',
    clearAll: 'Clear all',
    locked: 'Locked: ',
    previewName: 'Live measurement preview',
  },
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
