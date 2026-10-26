import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { ViewerEnvironmentProvider } from '@taucad/viewer/environment/viewer-environment';
import type { ViewerEnvironment, ViewerLabels } from '@taucad/viewer/environment/viewer-environment';
import { useTranslation } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import { useColor } from '#hooks/use-color.js';
import { useTheme } from '#hooks/use-theme.js';
import { useFeatureFlags } from '#flags/use-feature.js';
import {
  parseGraphicsBackendQueryOverride,
  resolveViewerGraphicsBackendPreference,
} from '#utils/graphics-backend-override.js';

const SectionViewTestBridge = React.lazy(async () => {
  const module = await import('#components/geometry/debug/section-view-test-bridge.js');
  return { default: module.SectionViewTestBridge };
});

/**
 * The viewer bar's words in the interface language (UI-UX-SinopiaCAD §3.3).
 *
 * @param t - The translator.
 * @returns Every label the viewer bar shows.
 */
export const buildViewerLabels = (t: Translate): ViewerLabels => ({
  viewerControls: t('viewer.viewerControls'),
  unavailableWithoutModel: t('viewer.unavailableWithoutModel'),
  fitView: t('viewer.fitView'),
  fitViewLabel: t('viewer.fitViewLabel'),
  viewFitted: t('viewer.viewFitted'),
  sectionView: t('viewer.sectionView'),
  sectionLabel: t('viewer.sectionLabel'),
  stopSection: t('viewer.stopSection'),
  measure: t('viewer.measure'),
  measureLabel: t('viewer.measureLabel'),
  stopMeasure: t('viewer.stopMeasure'),
  measuring: t('viewer.measuring'),
  toolOptions: (tool) => t('viewer.toolOptions', { tool }),
  done: t('viewer.done'),
  doneWith: (tool) => t('viewer.doneWith', { tool: tool.toLowerCase() }),
  viewerSettings: t('viewer.viewerSettings'),
  gridReadout: (size) => t('viewer.gridReadout', { size }),
  gridTooltip: t('viewer.gridTooltip'),
  unit: t('viewer.unit'),
  grid: t('viewer.grid'),
  lockGridSize: (size) => t('viewer.lockGridSize', { size }),
  gridZoomHint: t('viewer.gridZoomHint'),
  settings: {
    model: t('viewer.settings.model'),
    surfaces: t('viewer.settings.surfaces'),
    lines: t('viewer.settings.lines'),
    matcap: t('viewer.settings.matcap'),
    matcapInfo: t('viewer.settings.matcapInfo'),
    lightingActive: t('viewer.settings.lightingActive'),
    lightingInactive: t('viewer.settings.lightingInactive'),
    postProcessing: t('viewer.settings.postProcessing'),
    postProcessingInfo: t('viewer.settings.postProcessingInfo'),
    occlusionActive: t('viewer.settings.occlusionActive'),
    occlusionInactive: t('viewer.settings.occlusionInactive'),
    viewport: t('viewer.settings.viewport'),
    gizmo: t('viewer.settings.gizmo'),
    grid: t('viewer.settings.grid'),
    axes: t('viewer.settings.axes'),
    upDirection: t('viewer.settings.upDirection'),
    orthographic: t('viewer.settings.orthographic'),
    fieldOfView: t('viewer.settings.fieldOfView'),
    fieldOfViewAria: t('viewer.settings.fieldOfViewAria'),
    fieldOfViewDrag: t('viewer.settings.fieldOfViewDrag'),
    fieldOfViewKeys: t('viewer.settings.fieldOfViewKeys'),
    rendering: t('viewer.settings.rendering'),
    renderTimeout: t('viewer.settings.renderTimeout'),
    timeoutInfo: t('viewer.settings.timeoutInfo'),
    timeoutDisabled: t('viewer.settings.timeoutDisabled'),
    kernelSettings: t('viewer.settings.kernelSettings'),
    kernelDefaults: t('viewer.settings.kernelDefaults'),
    kernelChanged: (count) =>
      t(count === 1 ? 'viewer.settings.kernelChangedOne' : 'viewer.settings.kernelChanged', { count }),
    kernelReset: t('viewer.settings.kernelReset'),
    kernelPreset: t('viewer.settings.kernelPreset'),
    kernelCustom: t('viewer.settings.kernelCustom'),
    kernelModeOf: (label) => t('viewer.settings.kernelModeOf', { label }),
    kernelPresetOf: (label) => t('viewer.settings.kernelPresetOf', { label }),
    upAria: (axis) => t('viewer.settings.upAria', { axis }),
    seconds: (count) => t('viewer.settings.seconds', { count }),
    minutes: (count) => t('viewer.settings.minutes', { count }),
  },
  measurement: {
    operations: {
      'point-distance': t('viewer.measurement.operations.pointDistance'),
      'minimum-distance': t('viewer.measurement.operations.minimumDistance'),
      'center-distance': t('viewer.measurement.operations.centerDistance'),
      'plane-spacing': t('viewer.measurement.operations.planeSpacing'),
      'edge-length': t('viewer.measurement.operations.edgeLength'),
      radius: t('viewer.measurement.operations.radius'),
      diameter: t('viewer.measurement.operations.diameter'),
      angle: t('viewer.measurement.operations.angle'),
      'extent-x': t('viewer.measurement.operations.extentX'),
      'extent-y': t('viewer.measurement.operations.extentY'),
      'extent-z': t('viewer.measurement.operations.extentZ'),
    },
    qualities: {
      mesh: t('viewer.measurement.qualities.mesh'),
      fitted: t('viewer.measurement.qualities.fitted'),
      cad: t('viewer.measurement.qualities.cad'),
      snapshot: t('viewer.measurement.qualities.snapshot'),
    },
    list: t('viewer.measurement.list'),
    resolving: t('viewer.measurement.resolving'),
    unavailable: t('viewer.measurement.unavailable'),
    outOfDate: t('viewer.measurement.outOfDate'),
    pending: t('viewer.measurement.pending'),
    rootFrame: t('viewer.measurement.rootFrame'),
    featureFrame: t('viewer.measurement.featureFrame'),
    evidenceFor: (label) => t('viewer.measurement.evidenceFor', { label }),
    noEvidence: t('viewer.measurement.noEvidence'),
    summary: (operation, label, isOutOfDate) =>
      t(isOutOfDate ? 'viewer.measurement.summaryOutOfDate' : 'viewer.measurement.summary', { operation, label }),
    pin: (label) => t('viewer.measurement.pin', { label }),
    copyFull: (label) => t('viewer.measurement.copyFull', { label }),
    remove: (label) => t('viewer.measurement.remove', { label }),
    chooseHint: t('viewer.measurement.chooseHint'),
    clickTwoPoints: t('viewer.measurement.clickTwoPoints'),
    count: (count) => t(count === 1 ? 'viewer.measurement.countOne' : 'viewer.measurement.countMany', { count }),
    targets: (mode, filter) => t('viewer.measurement.targets', { mode, filter }),
    modeAuto: t('viewer.measurement.modeAuto'),
    modePoints: t('viewer.measurement.modePoints'),
    filterAll: t('viewer.measurement.filterAll'),
    filters: {
      point: t('viewer.measurement.filters.point'),
      edge: t('viewer.measurement.filters.edge'),
      face: t('viewer.measurement.filters.face'),
      circle: t('viewer.measurement.filters.circle'),
      body: t('viewer.measurement.filters.body'),
    },
    targetsName: t('viewer.measurement.targetsName'),
    mode: t('viewer.measurement.mode'),
    modeName: t('viewer.measurement.modeName'),
    snapOn: t('viewer.measurement.snapOn'),
    snapOff: t('viewer.measurement.snapOff'),
    snapTurnOff: t('viewer.measurement.snapTurnOff'),
    snapTurnOn: t('viewer.measurement.snapTurnOn'),
    filter: t('viewer.measurement.filter'),
    filterName: t('viewer.measurement.filterName'),
    operation: t('viewer.measurement.operation'),
    operationName: t('viewer.measurement.operationName'),
    frame: t('viewer.measurement.frame'),
    frameName: t('viewer.measurement.frameName'),
    frameRoot: t('viewer.measurement.frameRoot'),
    frameLocal: t('viewer.measurement.frameLocal'),
    chooseTarget: t('viewer.measurement.chooseTarget'),
    selectTarget: t('viewer.measurement.selectTarget'),
    loadMore: t('viewer.measurement.loadMore'),
    lock: t('viewer.measurement.lock'),
    unlock: t('viewer.measurement.unlock'),
    useTarget: t('viewer.measurement.useTarget'),
    clearAll: t('viewer.measurement.clearAll'),
    locked: t('viewer.measurement.locked'),
    previewName: t('viewer.measurement.previewName'),
  },
});

/**
 * Map the app's theme, accent colour and feature flags onto the viewer's environment, so every
 * `@taucad/viewer` component below draws with the workspace's look and switches. The `?graphicsBackend=` override
 * is read from the router location so a client-side navigation that adds or changes it switches the backend.
 */
export function AppViewerEnvironment({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const { theme, isHighContrast } = useTheme();
  const { serialized } = useColor();
  const flags = useFeatureFlags();
  const backendOverride = parseGraphicsBackendQueryOverride(useLocation().search);
  const { t } = useTranslation();
  const labels = useMemo(() => buildViewerLabels(t), [t]);

  const environment = useMemo(
    (): ViewerEnvironment => ({
      colorScheme: theme,
      isHighContrast,
      accentColor: serialized.hex,
      graphicsBackend: resolveViewerGraphicsBackendPreference(flags.webGpu, backendOverride),
      features: {
        tauDebug: flags.tauDebug,
        webGpuInspector: flags.webGpuInspector,
        webGpuShaderStacks: flags.webGpuShaderStacks,
      },
      debugStageBridge: SectionViewTestBridge,
      labels,
      // SinopiaCAD: fullscreen is the browser's and the keyboard's, not a button in the bar (UI-UX-SinopiaCAD §3.3).
      showFullscreenControl: false,
      showRenderFps: false,
    }),
    [
      labels,
      backendOverride,
      flags.tauDebug,
      flags.webGpu,
      flags.webGpuInspector,
      flags.webGpuShaderStacks,
      isHighContrast,
      serialized.hex,
      theme,
    ],
  );

  return <ViewerEnvironmentProvider value={environment}>{children}</ViewerEnvironmentProvider>;
}
