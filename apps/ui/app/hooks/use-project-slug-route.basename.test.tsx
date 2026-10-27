// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCanonicalProjectUrlCorrection } from '#hooks/use-project-slug-route.js';

vi.mock('#hooks/use-projects.js', () => ({
  useProjects: () => ({
    isLoading: false,
    projects: [{ id: 'proj_home', slugs: { workspaceSlug: 'home', projectSlug: 'gear' } }],
  }),
}));

const renderUnder = (basename: string): void => {
  renderHook(() => useCanonicalProjectUrlCorrection('proj_home'), {
    wrapper: ({ children }) => (
      <MemoryRouter basename={basename} initialEntries={[`${basename === '/' ? '' : basename}/w/home/old`]}>
        {children}
      </MemoryRouter>
    ),
  });
};

afterEach(() => {
  globalThis.history.replaceState(null, '', '/');
});

describe('useCanonicalProjectUrlCorrection under a sub-path', () => {
  it('should keep /cad in the address bar when it corrects the project address', () => {
    globalThis.history.replaceState(null, '', '/cad/w/home/old?chat=uno#vista');

    renderUnder('/cad');

    expect(`${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`).toBe(
      '/cad/w/home/gear?chat=uno#vista',
    );
  });

  it('should correct the address at the root exactly as before', () => {
    globalThis.history.replaceState(null, '', '/w/home/old');

    renderUnder('/');

    expect(globalThis.location.pathname).toBe('/w/home/gear');
  });
});
