import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from 'react-router';
import type * as Riconoscimento from '@taucad/smlib/riconoscimento';
import type * as SinopiaParts from '#services/sinopia-parts.js';
import type * as SinopiaRecognize from '#services/sinopia-recognize.js';
import type { LetturaNuovo } from '#services/sinopia-parts.js';

const owner = '10000000-0000-4000-8000-000000000001';
const project = '1841f9d7-ee9a-4684-a6d0-742ba0e64b52';
const asset = 'ce206280-5133-4da0-b62e-84133d86727b';
const modelId = '30000000-0000-4000-8000-000000000001';

const hooks = vi.hoisted(() => ({
  create: vi.fn(),
  getProjects: vi.fn(async () => []),
  navigate: vi.fn(),
  find: vi.fn(),
  recognize: vi.fn(),
}));
vi.mock('react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => hooks.navigate,
}));
vi.mock('#hooks/use-project-manager.js', () => ({
  useProjectManager: () => ({ createProject: hooks.create, getProjects: hooks.getProjects }),
}));
vi.mock('#hooks/use-file-manager.js', () => ({ useFileManager: () => ({ recordFiles: {} }) }));
vi.mock('#hooks/use-sinopia-session.js', () => ({
  useSinopiaSession: () => ({ status: 'signed-in', user: { id: '10000000-0000-4000-8000-000000000001' } }),
}));
vi.mock('#services/sinopia-modello-esistente.js', () => ({ cercaModelloEsistente: hooks.find }));
vi.mock('#services/sinopia-cad.js', () => ({ readSinopiaCadLink: vi.fn(async () => undefined) }));
vi.mock('#services/sinopia-parts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SinopiaParts>()),
  caricaSchedaParte: async () => ({
    schedaParte: {
      progetto: { id: '1841f9d7-ee9a-4684-a6d0-742ba0e64b52', verticale: 'accessories' },
      parte: { id: 'buckle_frame', etichetta: 'Cornice fibbia', nome: 'Cornice fibbia', box: [0, 0, 10, 10] },
      altreParti: [],
    },
    // Jsdom's Blob has no `arrayBuffer`: the flow only reads the bytes and the type.
    immagine: { type: 'image/png', arrayBuffer: async () => new ArrayBuffer(4) },
    maschera: {},
    mascheraPng: { type: 'image/png', arrayBuffer: async () => new ArrayBuffer(4) },
  }),
}));
vi.mock('#services/riconoscimento-immagini.js', () => ({
  preparaImmaginiRiconoscimento: async () => ({}),
  strumentiBrowser: {},
}));
vi.mock('#services/sinopia-recognize.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SinopiaRecognize>()),
  riconosciParte: hooks.recognize,
}));
vi.mock('@taucad/smlib/riconoscimento', async (importOriginal) => ({
  ...(await importOriginal<typeof Riconoscimento>()),
  catalogoFamiglie: () => [],
  domandaFamiglia: () => undefined,
  mappaLibreria: {},
  mappaPartType: {},
  risolviFamiglia: () => ({ vincolo: 'libera' }),
}));
vi.mock('#services/riconoscimento-verifica.js', () => ({ creaVerificatoreBrowser: () => ({ chiudi: vi.fn() }) }));
vi.mock('#services/riconoscimento-pipeline.js', () => ({
  eseguiPipelineRiconoscimento: async () => ({ tipo: 'fermata' }),
}));
vi.mock('#services/riconoscimento-progetto.js', () => ({
  progettoRiconosciuto: () => ({ files: {}, record: {}, piano: {}, nome: 'Cornice fibbia' }),
}));

const { useRiconoscimentoNuovo } = await import('#routes/nuovo/use-riconoscimento-nuovo.js');

const lettura: LetturaNuovo = {
  stato: 'parte',
  parametri: { progetto: project, asset, parte: 'buckle_frame' },
};

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() }));
  hooks.recognize.mockResolvedValue({ scheda: { famiglia: { id: 'fibbia', confidenza: 1, alternative: [] } } });
  hooks.create.mockResolvedValue({ slugs: { workspaceSlug: 'home', projectSlug: 'cornice-fibbia' } });
  hooks.find.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('«/cad/nuovo» keeps the piece in the Sinopia project it came from', () => {
  it('builds the model INSIDE the origin project, with its image and part, creating no second project', async () => {
    renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    expect(hooks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'Cornice fibbia',
        sinopiaProjectId: project,
        sinopiaSource: { assetId: asset, partId: 'buckle_frame' },
      }),
    );
    expect(hooks.find).toHaveBeenCalledWith(
      expect.objectContaining({
        origine: { projectId: project, assetId: asset, partId: 'buckle_frame' },
        userId: owner,
      }),
    );
    await waitFor(() => {
      expect(hooks.navigate).toHaveBeenCalled();
    });
  });

  it('asks before rebuilding a part that already has a model, and spends no recognition until asked', async () => {
    hooks.find.mockResolvedValue({ modelId, name: 'Cornice fibbia' });
    const { result } = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(result.current.fase.fase).toBe('esiste');
    });
    expect(hooks.recognize).not.toHaveBeenCalled();
    expect(hooks.create).not.toHaveBeenCalled();
    act(() => {
      result.current.apriEsistente();
    });
    // Not held on this device: the home opens the saved model from Sinopia.
    expect(hooks.navigate).toHaveBeenCalledWith(`/?model=${modelId}`);
  });

  it('opens the device’s own copy directly when it has one', async () => {
    hooks.find.mockResolvedValue({
      modelId,
      name: 'Cornice fibbia',
      slugs: { workspaceSlug: 'home', projectSlug: 'cornice-fibbia' },
    });
    const { result } = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(result.current.fase.fase).toBe('esiste');
    });
    act(() => {
      result.current.apriEsistente();
    });
    expect(hooks.navigate).toHaveBeenCalledWith(expect.stringContaining('cornice-fibbia'));
    expect(hooks.navigate).not.toHaveBeenCalledWith(expect.stringContaining('?model='));
  });

  it('rebuilds from scratch only on request, in the same project, without asking again', async () => {
    hooks.find.mockResolvedValue({ modelId, name: 'Cornice fibbia' });
    const { result } = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(result.current.fase.fase).toBe('esiste');
    });
    act(() => {
      result.current.rifaiDaCapo();
    });
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    expect(hooks.recognize).toHaveBeenCalledOnce();
    expect(hooks.find).toHaveBeenCalledOnce();
    expect(hooks.create).toHaveBeenCalledWith(expect.objectContaining({ sinopiaProjectId: project }));
  });
});

/** The `requestId` the n-th recognition call carried. */
const requestIdOf = (call: number): unknown =>
  (hooks.recognize.mock.calls[call] as unknown[] | undefined)?.[1] === undefined
    ? undefined
    : ((hooks.recognize.mock.calls[call] as unknown[])[1] as { requestId?: unknown }).requestId;

describe('«/cad/nuovo» books the recognition once per visit', () => {
  it('sends a request id that a reload of the same visit repeats, so Sinopia replays instead of charging again', async () => {
    const first = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    first.unmount();
    renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledTimes(2);
    });
    expect(hooks.recognize).toHaveBeenCalledTimes(2);
    expect(requestIdOf(0)).toMatch(/^[\da-f-]{36}$/u);
    expect(requestIdOf(1)).toBe(requestIdOf(0));
  });

  it('does not start the recognition again when the interface language changes', async () => {
    const { rerender } = renderHook(({ lingua }: { lingua: 'it' | 'en' }) => useRiconoscimentoNuovo(lettura, lingua), {
      initialProps: { lingua: 'it' },
    });
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledOnce();
    });
    rerender({ lingua: 'en' });
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    expect(hooks.recognize).toHaveBeenCalledOnce();
  });

  it('a reload after a language change repeats the same request, in the language it was booked in', async () => {
    const first = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    first.unmount();
    renderHook(() => useRiconoscimentoNuovo(lettura, 'en'));
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledTimes(2);
    });
    expect(requestIdOf(1)).toBe(requestIdOf(0));
    expect(hooks.recognize.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ lingua: 'it' }));
  });

  it('«Rifallo da capo» books a new request: it is a new recognition', async () => {
    const first = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    first.unmount();
    // Back on the same address, the part now has its model: rebuilding it is asked for, and paid, again.
    hooks.find.mockResolvedValue({ modelId, name: 'Cornice fibbia' });
    const { result } = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(result.current.fase.fase).toBe('esiste');
    });
    act(() => {
      result.current.rifaiDaCapo();
    });
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledTimes(2);
    });
    expect(requestIdOf(1)).toMatch(/^[\da-f-]{36}$/u);
    expect(requestIdOf(1)).not.toBe(requestIdOf(0));
  });

  it('a request id Sinopia no longer accepts (refunded, other body) is replaced once by a new one', async () => {
    const { ErroreRiconoscimento } = await import('#services/sinopia-recognize.js');
    hooks.recognize.mockRejectedValueOnce(new ErroreRiconoscimento('AI_REQUEST_CONFLICT', 409, 'già usata'));
    renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    expect(hooks.recognize).toHaveBeenCalledTimes(2);
    expect(requestIdOf(1)).not.toBe(requestIdOf(0));
  });
});
