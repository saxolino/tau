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
