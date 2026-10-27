// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  elencaFotoCampione,
  ErroreFoto,
  generaFotoCampione,
  leggiPrezziCad,
  versioneInviata,
} from '#services/sinopia-foto.js';
import type { RichiestaFoto } from '#services/sinopia-foto.js';

vi.mock('#environment.config.js', () => ({
  requireClientEnvironment: () => 'https://sinopia.test/functions/v1/sinopiacad/',
}));
vi.mock('#lib/sinopia-data-client.js', () => ({
  requireSinopiaUser: async () => ({ userId: 'u', token: 'jwt-of-the-user' }),
  getSinopiaDataClient: async () => {
    throw new Error('the tests inject their client');
  },
}));

const MODELLO = '55555555-5555-4555-8555-555555555555';
const PROGETTO = '0f9d7a8e-5b1c-4c2d-9e3f-1a2b3c4d5e6f';
const ASSET = '33333333-3333-4333-8333-333333333333';
const IMPRONTA = 'b'.repeat(64);

const richiesta: RichiestaFoto = {
  requestId: '66666666-6666-4666-8666-666666666666',
  maxCreditCost: 2,
  cadModelId: MODELLO,
  versionNumber: 3,
  vista: 'tre-quarti',
  materiale: { id: 'brass', finitura: 'polished' },
  livello: 'standard',
};

const risposta = {
  versione: 1,
  assetId: ASSET,
  progettoId: PROGETTO,
  url: 'https://cdn/x.png',
  aiAct: 'ai-generated',
  vista: 'tre-quarti',
  materiale: { id: 'brass', finitura: 'polished' },
  livello: 'standard',
  impronta: IMPRONTA,
  versionNumber: 3,
  costo: 2,
  modello: 'gemini-nano-banana-2.1',
  millisecondi: 4200,
  replayed: false,
};

describe('client of /v1/photo', () => {
  it('should post the choice and the sent version with the session token and the cost the person saw — no picture', async () => {
    const chiamate: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      chiamate.push({ url, init: init ?? {} });
      return Response.json(risposta);
    }) as unknown as typeof globalThis.fetch;
    const esito = await generaFotoCampione(richiesta, { fetch });
    expect(esito).toMatchObject({ assetId: ASSET, costo: 2, aiAct: 'ai-generated', versionNumber: 3, replayed: false });
    expect(chiamate[0]!.url).toBe('https://sinopia.test/functions/v1/sinopiacad/v1/photo');
    expect((chiamate[0]!.init.headers as Record<string, string>)['authorization']).toBe('Bearer jwt-of-the-user');
    const corpo = JSON.parse(chiamate[0]!.init.body as string) as Record<string, unknown>;
    expect(corpo).toStrictEqual({
      requestId: richiesta.requestId,
      maxCreditCost: 2,
      cadModelId: MODELLO,
      versionNumber: 3,
      vista: 'tre-quarti',
      materiale: { id: 'brass', finitura: 'polished' },
      livello: 'standard',
    });
  });

  it('should type the function’s credit errors, the network and a malformed answer', async () => {
    const risponde = (valore: Response) => (async () => valore) as unknown as typeof globalThis.fetch;
    await expect(
      generaFotoCampione(richiesta, {
        fetch: risponde(
          Response.json({ error: { type: 'CREDITS_NOT_CONFIGURED', message: 'prezzo' } }, { status: 503 }),
        ),
      }),
    ).rejects.toMatchObject({ codice: 'CREDITS_NOT_CONFIGURED', stato: 503 });
    await expect(
      generaFotoCampione(richiesta, {
        fetch: risponde(Response.json({ error: { type: 'INSUFFICIENT_CREDITS', message: 'pochi' } }, { status: 402 })),
      }),
    ).rejects.toMatchObject({ codice: 'INSUFFICIENT_CREDITS' });
    await expect(
      generaFotoCampione(richiesta, {
        fetch: risponde(Response.json({ error: { type: 'CAD_VERSION_MISSING', message: 'invia' } }, { status: 409 })),
      }),
    ).rejects.toMatchObject({ codice: 'CAD_VERSION_MISSING', stato: 409 });
    await expect(
      generaFotoCampione(richiesta, { fetch: risponde(Response.json({ ...risposta, impronta: 'x' })) }),
    ).rejects.toBeInstanceOf(ErroreFoto);
    const rete = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof globalThis.fetch;
    await expect(generaFotoCampione(richiesta, { fetch: rete })).rejects.toMatchObject({ codice: 'NETWORK' });
  });
});

/** A Supabase query builder that records its filters and resolves to the given rows. */
function client(righe: unknown[]) {
  const filtri: unknown[][] = [];
  const builder = new Proxy(
    {},
    {
      get(_target, nome: string) {
        if (nome === 'then') {
          return (risolvi: (valore: unknown) => void) => {
            risolvi({ data: righe, error: null });
          };
        }
        return (...argomenti: unknown[]) => {
          filtri.push([nome, ...argomenti]);
          return builder;
        };
      },
    },
  );
  return {
    filtri,
    getClient: async () => ({
      client: { from: (tabella: string) => (filtri.push(['from', tabella]), builder) },
      userId: 'u',
    }),
  };
}

describe('Sinopia reads of the gallery', () => {
  it('should read the active SinopiaCAD prices, a missing row staying missing', async () => {
    const { filtri, getClient } = client([{ operation_type: 'cad_photo', credits_required: 2 }]);
    expect(await leggiPrezziCad(getClient as never)).toStrictEqual({ cad_photo: 2 });
    expect(filtri).toContainEqual(['from', 'credit_costs']);
    expect(filtri).toContainEqual(['eq', 'is_active', true]);
  });

  it('should list this model’s photos with ownership filters and leave malformed rows out', async () => {
    const { filtri, getClient } = client([
      {
        id: ASSET,
        storage_bucket: 'creator-private',
        storage_path: `projects/${PROGETTO}/canvas-gen/r-generate-from-sketch.png`,
        created_at: '2026-10-27T08:00:00.000Z',
        metadata: {
          vista: 'fronte',
          materiale: { id: 'leather' },
          livello: 'fedele',
          impronta: IMPRONTA,
          aiAct: { label: 'ai-modified' },
        },
      },
      { id: 'not-a-uuid', storage_path: 'x', created_at: 'x', metadata: {} },
    ]);
    const link = { modelId: MODELLO, projectId: PROGETTO, userId: 'u', baseRevisionId: null };
    const foto = await elencaFotoCampione(link, getClient as never);
    expect(foto).toStrictEqual([
      {
        id: ASSET,
        vista: 'fronte',
        materiale: { id: 'leather' },
        livello: 'fedele',
        impronta: IMPRONTA,
        creata: Date.parse('2026-10-27T08:00:00.000Z'),
        sorgente: {
          tipo: 'storage',
          bucket: 'creator-private',
          path: `projects/${PROGETTO}/canvas-gen/r-generate-from-sketch.png`,
        },
        aiAct: 'ai-modified',
      },
    ]);
    expect(filtri).toContainEqual(['eq', 'user_id', 'u']);
    expect(filtri).toContainEqual(['eq', 'project_id', PROGETTO]);
    expect(filtri).toContainEqual(['eq', 'type', 'ai_render']);
    expect(filtri).toContainEqual(['contains', 'metadata', { cad_model_id: MODELLO, source: 'sinopiacad' }]);
  });

  it('should find the newest version sent with a GLB, skipping a delivery of the STEP alone', async () => {
    const { filtri, getClient } = client([
      {
        id: ASSET,
        version_number: 5,
        storage_bucket: 'creator-private',
        metadata: { files: [{ format: 'step', storage_path: 'p/v5/model.step' }] },
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        version_number: 4,
        storage_bucket: 'creator-private',
        metadata: { files: [{ format: 'glb', storage_path: `projects/${PROGETTO}/cad/${MODELLO}/v4/x/model.glb` }] },
      },
    ]);
    const link = { modelId: MODELLO, projectId: PROGETTO, userId: 'u', baseRevisionId: null };
    expect(await versioneInviata(link, getClient as never)).toStrictEqual({
      versionNumber: 4,
      assetId: '44444444-4444-4444-8444-444444444444',
      glb: { bucket: 'creator-private', path: `projects/${PROGETTO}/cad/${MODELLO}/v4/x/model.glb` },
    });
    expect(filtri).toContainEqual(['eq', 'type', 'cad_model']);
    expect(filtri).toContainEqual(['contains', 'metadata', { cad_model_id: MODELLO }]);
    expect(await versioneInviata(link, client([]).getClient as never)).toBeUndefined();
  });
});
