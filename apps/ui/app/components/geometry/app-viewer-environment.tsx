import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import { ViewerEnvironmentProvider } from '@taucad/viewer/environment/viewer-environment';
import type { ViewerEnvironment } from '@taucad/viewer/environment/viewer-environment';
import { useColor } from '#hooks/use-color.js';
import { useTheme } from '#hooks/use-theme.js';
import { useFeatureFlags } from '#flags/use-feature.js';
import { resolveViewerGraphicsBackendPreference } from '#utils/graphics-backend-override.js';

const SectionViewTestBridge = React.lazy(async () => {
  const module = await import('#components/geometry/debug/section-view-test-bridge.js');
  return { default: module.SectionViewTestBridge };
});

/**
 * Map the app's theme, accent colour and feature flags onto the viewer's environment, so every
 * `@taucad/viewer` component below draws with the workspace's look and switches.
 */
export function AppViewerEnvironment({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const { theme, isHighContrast } = useTheme();
  const { serialized } = useColor();
  const flags = useFeatureFlags();

  const environment = useMemo(
    (): ViewerEnvironment => ({
      colorScheme: theme,
      isHighContrast,
      accentColor: serialized.hex,
      graphicsBackend: resolveViewerGraphicsBackendPreference(flags.webGpu),
      features: {
        tauDebug: flags.tauDebug,
        webGpuInspector: flags.webGpuInspector,
        webGpuShaderStacks: flags.webGpuShaderStacks,
      },
      debugStageBridge: SectionViewTestBridge,
    }),
    [
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
