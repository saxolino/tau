// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Router from 'react-router';
import { ErrorPage } from '#components/error-page.js';
import { setLanguage } from '#i18n/language.js';

const failure = vi.hoisted((): { value: unknown } => ({ value: undefined }));
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  useRouteError: () => failure.value,
}));
const analytics = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock('#hooks/use-analytics.js', () => ({ useAnalytics: () => analytics }));
vi.mock('#lib/error-reporting.js', () => ({ reportUiError: vi.fn() }));

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(['it', 'en'] as const)('Recovery screens in %s', (language) => {
  it.each([
    new Error('secret source.ts stack details'),
    { status: 500, statusText: 'internal diagnostics', data: 'secret source.ts stack details', internal: false },
    'secret source.ts stack details',
  ])('should keep diagnostics in the console and show a recovery action for %j', (error) => {
    setLanguage(language);
    failure.value = error;
    render(
      <MemoryRouter>
        <ErrorPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent(/secret|source\.ts|diagnostics/u);
    expect(
      screen.getByRole('heading', {
        name: language === 'it' ? 'Non riesco ad aprire SinopiaCAD' : 'I can’t open SinopiaCAD',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: language === 'it' ? 'Ricarica la pagina' : 'Reload the page' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/projects');
    expect(console.error).toHaveBeenCalledWith('[sinopiacad] application error', error);
  });

  it('should show a missing page without the raw address or Tau links', () => {
    setLanguage(language);
    failure.value = { status: 404, statusText: 'Not found', data: 'private-path', internal: false };
    render(
      <MemoryRouter initialEntries={['/private-path']}>
        <ErrorPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: language === 'it' ? 'Pagina non trovata' : 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent(/private-path|Tau|404/u);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/projects');
    expect(console.error).not.toHaveBeenCalled();
  });
});
