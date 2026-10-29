/* oxlint-disable typescript/no-restricted-types -- Supabase rows keep their nullable wire columns. */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { CloudProject } from '#hooks/use-cloud-projects.js';
import type * as OpenCloudProjectModule from '#hooks/use-open-cloud-project.js';
import type { SinopiaCadModel } from '#services/sinopia-cad.js';

const modelId = '70d7a84c-0000-4000-8000-000000000001';
const projectId = '11111111-0000-4000-8000-000000000002';
const userId = '22222222-0000-4000-8000-000000000003';

const state = vi.hoisted(() => ({
  cloud: [] as CloudProject[],
  isCloudSettled: true,
  isCloudFailed: false,
  isLocalLoading: false,
}));
const openCloudProject = vi.hoisted(() => vi.fn<(entry: CloudProject) => Promise<void>>(async () => undefined));
const toastError = vi.hoisted(() => vi.fn());

vi.mock('#hooks/use-cloud-projects.js', () => ({
  useCloudProjects: () => ({
    projects: state.cloud,
    isSettled: state.isCloudSettled,
    isFailed: state.isCloudFailed,
    isFetching: false,
    retry: vi.fn(),
  }),
}));
vi.mock('#hooks/use-open-cloud-project.js', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenCloudProjectModule>()),
  useOpenCloudProject: () => openCloudProject,
}));
vi.mock('#hooks/use-projects.js', () => ({
  useProjects: () => ({ projects: [], isLoading: state.isLocalLoading, error: undefined }),
}));
vi.mock('#components/ui/sonner.js', () => ({ toast: { error: toastError, warning: vi.fn(), info: vi.fn() } }));

const { OpenSinopiaModelFromLink, useSinopiaEntryLink } = await import('#routes/_index/sinopia-entry-link.js');

const model = (snapshot: string | null): SinopiaCadModel => ({
  id: modelId,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
  project_id: projectId,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
  user_id: userId,
  name: 'Cornice fibbia',
  engine: 'smlib',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
  head_revision_id: null,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
  snapshot_path: snapshot,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
  thumbnail_path: null,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
  snapshot_bytes: null,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase wire columns.
  updated_at: '2026-10-27T10:00:00.000Z',
});
const entry = (snapshot: string | null = 'projects/x/cad/y/saves/z/model.zip'): CloudProject => ({
  id: 'proj_cornice',
  name: 'Cornice fibbia',
  role: 'owner',
  sinopia: model(snapshot),
});

/** What the home does with the link: the model opener while `?model=` is there, and the address on screen. */
function Harness(): React.JSX.Element {
  const link = useSinopiaEntryLink();
  const location = useLocation();
  const navigate = useNavigate();
  // The `consume` of the first render: a callback captured before the address changed (as an effect's `onSpent` is).
  const first = useRef(link.consume);
  return (
    <>
      <output aria-label='indirizzo'>{location.search}</output>
      <button
        type='button'
        onClick={() => {
          void navigate(`?model=${modelId}&altro=1`, { replace: true });
        }}
      >
        cambia indirizzo
      </button>
      <button
        type='button'
        onClick={() => {
          first.current();
        }}
      >
        consuma col vecchio
      </button>
      {link.modelId === undefined ? null : <OpenSinopiaModelFromLink modelId={link.modelId} onSpent={link.consume} />}
    </>
  );
}

const mount = (search: string): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <Harness />
    </MemoryRouter>,
  );
const address = (): string => screen.getByRole('status', { name: 'indirizzo' }).textContent;

describe('useSinopiaEntryLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLanguage('it');
    state.cloud = [entry()];
    state.isCloudSettled = true;
    state.isCloudFailed = false;
    state.isLocalLoading = false;
    openCloudProject.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    resetLanguageForTests();
  });

  it('should take project, model and section off the address together once the model link is spent', async () => {
    mount(`?project=${projectId}&model=${modelId}&sezione=foto`);
    await waitFor(() => {
      expect(openCloudProject).toHaveBeenCalledOnce();
    });
    await waitFor(() => {
      expect(address()).toBe('');
    });
  });

  it('should read the address as it is now: a callback from an older render never brings a parameter back', async () => {
    state.isCloudSettled = false;
    mount(`?project=${projectId}&model=${modelId}`);
    await userEvent.click(screen.getByRole('button', { name: 'cambia indirizzo' }));
    expect(address()).toBe(`?model=${modelId}&altro=1`);
    await userEvent.click(screen.getByRole('button', { name: 'consuma col vecchio' }));
    expect(address()).toBe('?altro=1');
  });
});

describe('OpenSinopiaModelFromLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLanguage('it');
    state.cloud = [entry()];
    state.isCloudSettled = true;
    state.isCloudFailed = false;
    state.isLocalLoading = false;
    openCloudProject.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    resetLanguageForTests();
  });

  it('should wait for the projects of this device before opening, so a cold tab never mistakes them for none', async () => {
    state.isLocalLoading = true;
    const view = mount(`?model=${modelId}`);
    await act(async () => {
      await Promise.resolve();
    });
    expect(openCloudProject).not.toHaveBeenCalled();
    expect(address()).toBe(`?model=${modelId}`);
    state.isLocalLoading = false;
    view.rerender(
      <MemoryRouter initialEntries={[`/?model=${modelId}`]}>
        <Harness />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(openCloudProject).toHaveBeenCalledWith(expect.objectContaining({ id: 'proj_cornice' }));
    });
  });

  it.each([
    {
      code: 'SINOPIA_MODEL_NOT_SAVED',
      it: 'Questo modello non è ancora salvato su Sinopia: aprilo sul computer dove l’hai creato.',
    },
    {
      code: 'SINOPIA_MODEL_IDENTITY_MISMATCH',
      it: 'Su questo computer c’è un progetto con lo stesso indirizzo che non è questo modello: non lo apro per non mescolarli.',
    },
    { code: 'offline', it: 'Non riesco ad aprire il modello. Controlla la connessione e riprova.' },
  ])('should say why the model did not open ($code)', async ({ code, it: sentence }) => {
    openCloudProject.mockRejectedValueOnce(new Error(code));
    mount(`?project=${projectId}&model=${modelId}`);
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(sentence);
    });
    await waitFor(() => {
      expect(address()).toBe('');
    });
  });
});
