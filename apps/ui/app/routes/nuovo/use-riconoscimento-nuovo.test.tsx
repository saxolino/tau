import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReactRouter from 'react-router';
import type * as Riconoscimento from '@taucad/smlib/riconoscimento';
import type * as SinopiaParts from '#services/sinopia-parts.js';
import type * as SinopiaRecognize from '#services/sinopia-recognize.js';
import type * as SinopiaViste from '#services/sinopia-viste.js';
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
  prices: vi.fn(),
  family: vi.fn(),
  views: vi.fn(),
  pipeline: vi.fn(),
  download: vi.fn(),
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
      immagine: { larghezzaPx: 100, altezzaPx: 100 },
      parte: { id: 'buckle_frame', etichetta: 'Cornice fibbia', nome: 'Cornice fibbia', box: [0, 0, 10, 10] },
      altreParti: [],
    },
    // Jsdom's Blob has no `arrayBuffer`: the flow only reads the bytes and the type.
    immagine: { type: 'image/png', arrayBuffer: async () => new ArrayBuffer(4) },
    maschera: {},
    mascheraPng: { type: 'image/png', arrayBuffer: async () => new ArrayBuffer(4) },
  }),
  leggiVistaDelLink: async () => undefined,
}));
vi.mock('#services/riconoscimento-immagini.js', () => ({
  preparaImmaginiRiconoscimento: async () => ({}),
  strumentiBrowser: {},
  mascheraDellaVista: async () => ({ png: Uint8Array.of(9), origine: 'sfondo' }),
  vistaPerRiconoscimento: async (_immagine: unknown, ruolo: string, faccia: string) => ({
    ruolo,
    faccia,
    mediaType: 'image/png',
    data: 'AA==',
  }),
}));
vi.mock('#services/sinopia-foto.js', () => ({ leggiPrezziCad: hooks.prices }));
vi.mock('#services/sinopia-viste.js', async (importOriginal) => ({
  ...(await importOriginal<typeof SinopiaViste>()),
  generaVista: hooks.views,
  scaricaVista: hooks.download,
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
  risolviFamiglia: hooks.family,
}));
vi.mock('#services/riconoscimento-verifica.js', () => ({ creaVerificatoreBrowser: () => ({ chiudi: vi.fn() }) }));
vi.mock('#services/riconoscimento-pipeline.js', () => ({ eseguiPipelineRiconoscimento: hooks.pipeline }));
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
  // eslint-disable-next-line @typescript-eslint/naming-convention -- le righe di `credit_costs` di Sinopia.
  hooks.prices.mockResolvedValue({ cad_recognize: 2, cad_part_view: 2 });
  hooks.family.mockReturnValue({ vincolo: 'libera' });
  hooks.pipeline.mockResolvedValue({ tipo: 'fermata' });
  hooks.download.mockResolvedValue({ type: 'image/png', arrayBuffer: async () => new ArrayBuffer(2) });
});

type Hook = Readonly<{ result: Readonly<{ current: ReturnType<typeof useRiconoscimentoNuovo> }> }>;

/** Wait for the cost and press «Costruisci». */
const costruisci = async ({ result }: Hook): Promise<void> => {
  await waitFor(() => {
    expect(result.current.fase.fase).toBe('conferma');
  });
  act(() => {
    result.current.costruisci();
  });
};
afterEach(() => {
  vi.clearAllMocks();
});

describe('«/cad/nuovo» keeps the piece in the Sinopia project it came from', () => {
  it('builds the model INSIDE the origin project, with its image and part, creating no second project', async () => {
    await costruisci(renderHook(() => useRiconoscimentoNuovo(lettura, 'it')));
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
    // Before any spending: not even the prices are read.
    expect(hooks.prices).not.toHaveBeenCalled();
    expect(hooks.views).not.toHaveBeenCalled();
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
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hook.result.current.fase.fase).toBe('esiste');
    });
    act(() => {
      hook.result.current.rifaiDaCapo();
    });
    await costruisci(hook);
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
    await costruisci(first);
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    first.unmount();
    // The visit was confirmed: the reload goes on without asking for the cost again.
    renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledTimes(2);
    });
    expect(hooks.recognize).toHaveBeenCalledTimes(2);
    expect(requestIdOf(0)).toMatch(/^[\da-f-]{36}$/u);
    expect(requestIdOf(1)).toBe(requestIdOf(0));
  });

  it('does not start the recognition again when the interface language changes', async () => {
    const hook = renderHook(({ lingua }: { lingua: 'it' | 'en' }) => useRiconoscimentoNuovo(lettura, lingua), {
      initialProps: { lingua: 'it' },
    });
    const { rerender } = hook;
    await costruisci(hook);
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
    await costruisci(first);
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
    await costruisci(first);
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    first.unmount();
    // Back on the same address, the part now has its model: rebuilding it is asked for, and paid, again.
    hooks.find.mockResolvedValue({ modelId, name: 'Cornice fibbia' });
    const second = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(second.result.current.fase.fase).toBe('esiste');
    });
    act(() => {
      second.result.current.rifaiDaCapo();
    });
    await costruisci(second);
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledTimes(2);
    });
    expect(requestIdOf(1)).toMatch(/^[\da-f-]{36}$/u);
    expect(requestIdOf(1)).not.toBe(requestIdOf(0));
  });

  it('a request id Sinopia no longer accepts (refunded, other body) is replaced once by a new one', async () => {
    const { ErroreRiconoscimento } = await import('#services/sinopia-recognize.js');
    hooks.recognize.mockRejectedValueOnce(new ErroreRiconoscimento('AI_REQUEST_CONFLICT', 409, 'già usata'));
    await costruisci(renderHook(() => useRiconoscimentoNuovo(lettura, 'it')));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    expect(hooks.recognize).toHaveBeenCalledTimes(2);
    expect(requestIdOf(1)).not.toBe(requestIdOf(0));
  });
});

// ── Viste ortogonali ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A view as `/v1/views` answers it. */
const vista = (ruolo: 'principale' | 'controllo', requestId: string) => ({
  versione: 1,
  ruolo,
  famiglia: 'fibbia',
  faccia: ruolo === 'principale' ? 'sopra' : 'fianco_esterno',
  assetId: ruolo === 'principale' ? '7a000000-0000-4000-8000-000000000001' : '7a000000-0000-4000-8000-000000000002',
  progettoId: project,
  percorso: { bucket: 'creator-private', path: `projects/${project}/canvas-gen/${requestId}-isolate-part.png` },
  mediaType: 'image/png',
  costo: 2,
});

/** The request id the n-th view call carried, and its role. */
const vistaChiamata = (call: number): { ruolo: unknown; requestId: unknown } => {
  const [richiesta, opzioni] = hooks.views.mock.calls[call] as [{ ruolo: unknown }, { requestId: unknown }];
  return { ruolo: richiesta.ruolo, requestId: opzioni.requestId };
};

const nonCombacia = {
  tipo: 'consegna',
  scheda: { famiglia: { id: 'fibbia', confidenza: 1, alternative: [] }, parametri: [] },
  consegna: {},
  verifica: { stato: 'fatta', iou: 0.95, camera: { azimuth: 0, elevation: 90, rollo: 0, pxPerMm: 3, cx: 0, cy: 0 } },
  confronti: {
    esito: 'non_combacia',
    motivo: 'sorgente',
    iou: { principale: 0.95, controllo: 0.92, sorgente: 0.71 },
    parametri: 'principale',
    risposta: {},
    sorgente: { iou: 0.71, camera: { azimuth: 0, elevation: 80, rollo: 0, pxPerMm: 3, cx: 0, cy: 0 } },
  },
};

describe('«/cad/nuovo» with the generated views', () => {
  beforeEach(() => {
    hooks.family.mockReturnValue({ vincolo: 'vincolata', famiglia: 'fibbia', variante: 'rettangolare' });
    hooks.views.mockImplementation(
      async (richiesta: { ruolo: 'principale' | 'controllo' }, opzioni: { requestId: string }) =>
        vista(richiesta.ruolo, opzioni.requestId),
    );
  });

  it('shows the cost first, then generates main and control view, then recognises with them', async () => {
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hook.result.current.fase.fase).toBe('conferma');
    });
    // Nothing paid starts before the click: two views at 2 and the recognition at 2.
    expect(hook.result.current.fase).toMatchObject({
      costo: { totale: 6, riconoscimento: 2, viste: 2, prezzoVista: 2, riusata: false },
    });
    expect(hooks.views).not.toHaveBeenCalled();
    expect(hooks.recognize).not.toHaveBeenCalled();
    act(() => {
      hook.result.current.costruisci();
    });
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledOnce();
    });
    expect(hooks.views).toHaveBeenCalledTimes(2);
    expect(vistaChiamata(0).ruolo).toBe('principale');
    expect(vistaChiamata(1).ruolo).toBe('controllo');
    expect(hooks.views.mock.calls[1]?.[0]).toMatchObject({ principale: { assetId: vista('principale', 'x').assetId } });
    expect(hooks.recognize.mock.calls[0]?.[0]).toMatchObject({
      viste: [
        { ruolo: 'principale', faccia: 'sopra' },
        { ruolo: 'controllo', faccia: 'fianco_esterno' },
      ],
    });
    // The check runs on the main view's mask.
    await waitFor(() => {
      expect(hooks.pipeline).toHaveBeenCalledOnce();
    });
    expect(hooks.pipeline.mock.calls[0]?.[0]).toMatchObject({
      viste: { principale: { faccia: 'sopra' }, controllo: { faccia: 'fianco_esterno' } },
    });
  });

  it('repeats the same view ids after a reload halfway, and pays nothing new', async () => {
    hooks.recognize.mockImplementationOnce(
      async () =>
        new Promise(() => {
          // Never settles: the page is reloaded while the recognition is running.
        }),
    );
    const first = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(first);
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledOnce();
    });
    first.unmount();
    renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledTimes(2);
    });
    expect(hooks.views).toHaveBeenCalledTimes(4);
    expect(vistaChiamata(2).requestId).toBe(vistaChiamata(0).requestId);
    expect(vistaChiamata(3).requestId).toBe(vistaChiamata(1).requestId);
    expect(requestIdOf(1)).toBe(requestIdOf(0));
  });

  it('goes on as today, on the photo alone, when the function has no views route', async () => {
    const { ErroreVista } = await import('#services/sinopia-viste.js');
    hooks.views.mockRejectedValue(new ErroreVista('ROUTE_MISSING', 404, 'HTTP 404'));
    await costruisci(renderHook(() => useRiconoscimentoNuovo(lettura, 'it')));
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    expect(hooks.views).toHaveBeenCalledOnce();
    expect(hooks.recognize.mock.calls[0]?.[0]).not.toHaveProperty('viste');
    expect(hooks.pipeline.mock.calls[0]?.[0]).not.toHaveProperty('viste');
  });

  it('says the rebuilt view does not match the photo, with «Rigenera» and «Conferma le misure»', async () => {
    hooks.pipeline.mockResolvedValue(nonCombacia);
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(hook);
    await waitFor(() => {
      expect(hook.result.current.fase.fase).toBe('non_combacia');
    });
    expect(hook.result.current.fase).toMatchObject({ motivo: 'sorgente', iou: 0.71, costoRigenera: 6 });
    expect(hooks.create).not.toHaveBeenCalled();
    act(() => {
      hook.result.current.confermaLeMisure();
    });
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
  });

  it('«Rigenera le viste» opens round 2 with new ids for the views and the recognition', async () => {
    hooks.pipeline.mockResolvedValue(nonCombacia);
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(hook);
    await waitFor(() => {
      expect(hook.result.current.fase.fase).toBe('non_combacia');
    });
    act(() => {
      hook.result.current.rigeneraViste();
    });
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledTimes(2);
    });
    // No second confirmation: the button said what it costs.
    expect(hooks.views).toHaveBeenCalledTimes(4);
    expect(vistaChiamata(2).requestId).not.toBe(vistaChiamata(0).requestId);
    expect(vistaChiamata(3).requestId).not.toBe(vistaChiamata(1).requestId);
    expect(requestIdOf(1)).not.toBe(requestIdOf(0));
    const visita = Object.keys(sessionStorage).find((chiave) => chiave.endsWith(':giro'))!;
    expect(JSON.parse(sessionStorage.getItem(visita)!)).toStrictEqual({
      giro: 1,
      confermata: true,
      prezzi: { riconoscimento: 2, vista: 2 },
    });
  });

  it('offers «Riprova» and «Continua senza viste» when the view generator is down, and goes on without them', async () => {
    const { ErroreVista } = await import('#services/sinopia-viste.js');
    hooks.views.mockRejectedValueOnce(new ErroreVista('PROVIDER_UNAVAILABLE', 503, 'giù'));
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(hook);
    await waitFor(() => {
      expect(hook.result.current.fase).toMatchObject({ fase: 'errore', senzaViste: true, riprova: true });
    });
    expect(hooks.recognize).not.toHaveBeenCalled();
    act(() => {
      hook.result.current.continuaSenzaViste();
    });
    await waitFor(() => {
      expect(hooks.create).toHaveBeenCalledOnce();
    });
    expect(hooks.recognize.mock.calls[0]?.[0]).not.toHaveProperty('viste');
  });
});

/** Le righe di `credit_costs` di Sinopia, come le restituisce `leggiPrezziCad`. */
const prezziSinopia = (riconoscimento: number, vista: number): Record<string, number> => ({
  // eslint-disable-next-line @typescript-eslint/naming-convention -- le chiavi di `credit_costs` di Sinopia.
  cad_recognize: riconoscimento,
  // eslint-disable-next-line @typescript-eslint/naming-convention -- le chiavi di `credit_costs` di Sinopia.
  cad_part_view: vista,
});

/** Il tetto (`maxCreditCost`) che la n-esima chiamata di una funzione del client avrebbe mandato. */
const tettoDi = async (chiamate: unknown[][], indice: number): Promise<unknown> => {
  const opzioni = chiamate[indice]?.[1] as { prezzo?: () => Promise<number> } | undefined;
  return opzioni?.prezzo ? opzioni.prezzo() : undefined;
};

describe('«/cad/nuovo» pays only what was confirmed, and keeps what is already paid', () => {
  beforeEach(() => {
    hooks.family.mockReturnValue({ vincolo: 'vincolata', famiglia: 'fibbia', variante: 'rettangolare' });
    hooks.views.mockImplementation(
      async (richiesta: { ruolo: 'principale' | 'controllo' }, opzioni: { requestId: string }) =>
        vista(richiesta.ruolo, opzioni.requestId),
    );
  });

  it('sends the confirmed prices as ceilings, and shows the cost again when the price rose meanwhile', async () => {
    const { ErroreVista } = await import('#services/sinopia-viste.js');
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(hook);
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledOnce();
    });
    // The ceiling is the price on the button, not a price read again at the call.
    hooks.prices.mockResolvedValue(prezziSinopia(9, 9));
    expect(await tettoDi(hooks.views.mock.calls, 0)).toBe(2);
    expect(await tettoDi(hooks.views.mock.calls, 1)).toBe(2);
    expect(await tettoDi(hooks.recognize.mock.calls, 0)).toBe(2);
    hook.unmount();

    // A new visit: Sinopia raised the price of a view after the click and refuses the old ceiling.
    sessionStorage.clear();
    vi.clearAllMocks();
    hooks.prices.mockResolvedValue(prezziSinopia(2, 2));
    hooks.views.mockRejectedValueOnce(new ErroreVista('CREDIT_COST_CHANGED', 409, 'prezzo cambiato'));
    hooks.recognize.mockResolvedValue({ scheda: { famiglia: { id: 'fibbia', confidenza: 1, alternative: [] } } });
    hooks.create.mockResolvedValue({ slugs: { workspaceSlug: 'home', projectSlug: 'cornice-fibbia' } });
    const second = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(second);
    hooks.prices.mockResolvedValue(prezziSinopia(2, 3));
    await waitFor(() => {
      expect(second.result.current.fase).toMatchObject({ fase: 'conferma', costo: { totale: 8, prezzoVista: 3 } });
    });
    expect(hooks.recognize).not.toHaveBeenCalled();
    act(() => {
      second.result.current.costruisci();
    });
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledOnce();
    });
    expect(await tettoDi(hooks.views.mock.calls, 1)).toBe(3);
  });

  it('keeps the paid main view when the control fails and the designer goes on without generating again', async () => {
    const { ErroreVista } = await import('#services/sinopia-viste.js');
    hooks.views.mockImplementation(
      async (richiesta: { ruolo: 'principale' | 'controllo' }, opzioni: { requestId: string }) => {
        if (richiesta.ruolo === 'controllo') {
          throw new ErroreVista('PROVIDER_UNAVAILABLE', 503, 'giù');
        }
        return vista(richiesta.ruolo, opzioni.requestId);
      },
    );
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(hook);
    await waitFor(() => {
      expect(hook.result.current.fase).toMatchObject({ fase: 'errore', senzaViste: true, conPrincipale: true });
    });
    expect(hooks.views).toHaveBeenCalledTimes(2);
    act(() => {
      hook.result.current.continuaSenzaViste();
    });
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledOnce();
    });
    // The recognition gets the main view; nothing is generated again.
    expect(hooks.views).toHaveBeenCalledTimes(2);
    expect(hooks.recognize.mock.calls[0]?.[0]).toMatchObject({ viste: [{ ruolo: 'principale', faccia: 'sopra' }] });
    const corpo = hooks.recognize.mock.calls[0]?.[0] as { viste?: unknown[] } | undefined;
    expect(corpo?.viste).toHaveLength(1);
  });

  it('stops with «Riprova» when a paid view cannot be downloaded, and the retry replays the same requests', async () => {
    hooks.download.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(hook);
    await waitFor(() => {
      expect(hook.result.current.fase).toMatchObject({
        fase: 'errore',
        messaggio: 'riconoscimento.generatedViews.unavailable',
        riprova: true,
        senzaViste: true,
      });
    });
    expect(hooks.recognize).not.toHaveBeenCalled();
    act(() => {
      hook.result.current.riprova();
    });
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledOnce();
    });
    // The main view was paid before the download failed: the retry repeats its id, Sinopia replays it for free.
    expect(vistaChiamata(1).ruolo).toBe('principale');
    expect(vistaChiamata(1).requestId).toBe(vistaChiamata(0).requestId);
    expect(hooks.recognize.mock.calls[0]?.[0]).toMatchObject({
      viste: [{ ruolo: 'principale' }, { ruolo: 'controllo' }],
    });
  });

  it('offers to go on with the photo alone when the photo and the views are too large together', async () => {
    const { ErroreRiconoscimento } = await import('#services/sinopia-recognize.js');
    hooks.recognize.mockRejectedValueOnce(new ErroreRiconoscimento('REQUEST_TOO_LARGE', 413, 'troppo grande'));
    const hook = renderHook(() => useRiconoscimentoNuovo(lettura, 'it'));
    await costruisci(hook);
    await waitFor(() => {
      expect(hook.result.current.fase).toMatchObject({
        fase: 'errore',
        messaggio: 'riconoscimento.errors.tooLargeWithViews',
        senzaViste: true,
      });
    });
    act(() => {
      hook.result.current.continuaSenzaViste();
    });
    await waitFor(() => {
      expect(hooks.recognize).toHaveBeenCalledTimes(2);
    });
    expect(hooks.recognize.mock.calls[1]?.[0]).not.toHaveProperty('viste');
  });
});
