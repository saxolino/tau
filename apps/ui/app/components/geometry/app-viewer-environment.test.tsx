// @vitest-environment jsdom
/**
 * The app's viewer environment follows the router location: a client-side navigation that adds or changes
 * `?graphicsBackend=` switches the backend the viewer requests, as the thumbnail-generation e2e route relies on.
 */

import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useViewerEnvironment, useViewerLabels } from '@taucad/viewer/environment/viewer-environment';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

import { AppViewerEnvironment } from '#components/geometry/app-viewer-environment.js';

vi.mock('#hooks/use-theme.js', () => ({
  useTheme: () => ({ theme: 'light', isHighContrast: false }),
}));

vi.mock('#hooks/use-color.js', () => ({
  useColor: () => ({ serialized: { hex: 'accent' } }),
}));

function BackendProbe(): React.JSX.Element {
  const environment = useViewerEnvironment();
  const labels = useViewerLabels();
  return (
    <>
      <output aria-label='graphics backend'>{environment.graphicsBackend}</output>
      <output aria-label='fullscreen control'>{String(environment.showFullscreenControl)}</output>
      <output aria-label='bar words'>
        {[labels.fitViewLabel, labels.sectionLabel, labels.measureLabel, labels.viewerSettings].join(' · ')}
      </output>
    </>
  );
}

const mountAt = (path: string): ReturnType<typeof createMemoryRouter> => {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <AppViewerEnvironment>
            <BackendProbe />
          </AppViewerEnvironment>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('AppViewerEnvironment', () => {
  // SinopiaCAD: the bar in the design's words (UI-UX-SinopiaCAD §3.3), no Fullscreen button.
  it.each([
    ['it', 'Adatta · Sezione · Misura · Vista…'],
    ['en', 'Fit · Section · Measure · View…'],
  ] as const)('gives the viewer bar its %s words and hides Fullscreen', async (language, words) => {
    setLanguage(language);
    mountAt('/w/workspace/project');

    expect(await screen.findByLabelText('bar words')).toHaveTextContent(words);
    expect(screen.getByLabelText('fullscreen control')).toHaveTextContent('false');
  });

  it('switches the backend when a client-side navigation adds the override', async () => {
    const router = mountAt('/__e2e/user-project-thumbnail-generation');
    expect(screen.getByLabelText('graphics backend')).toHaveTextContent('webgl');

    await act(async () => router.navigate('/w/workspace/project?graphicsBackend=webgpu'));

    expect(screen.getByLabelText('graphics backend')).toHaveTextContent('webgpu');
  });

  it('falls back to the flag when a navigation removes the override', async () => {
    const router = mountAt('/w/workspace/project?graphicsBackend=webgpu');
    expect(screen.getByLabelText('graphics backend')).toHaveTextContent('webgpu');

    await act(async () => router.navigate('/w/workspace/project'));

    expect(screen.getByLabelText('graphics backend')).toHaveTextContent('webgl');
  });
});
