import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schedaParteDiProva } from '@taucad/smlib/riconoscimento';
import { scriptSinopiaBackend, sinopiaFakeView } from '#lib/testing/sinopia-backend.js';
import { leggiParametriNuovo, vistaRiusabile } from '#services/sinopia-parts.js';
import {
  chiaveVista,
  decisioneVista,
  ErroreVista,
  generaVista,
  statoVisita,
  vistaUnaVolta,
} from '#services/sinopia-viste.js';
import type { RichiestaVista } from '#services/sinopia-viste.js';

vi.mock('#lib/sinopia-data-client.js', () => ({
  requireSinopiaUser: async () => ({ userId: 'u', token: 'jwt-of-the-user' }),
}));

const base = 'https://sinopia.test';
const principale: RichiestaVista = { ruolo: 'principale', famiglia: 'fibbia', schedaParte: schedaParteDiProva };
const opzioni = { base, prezzo: async () => 2 } as const;

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('client of /v1/views', () => {
  it('should post one view with its price ceiling and read the face the server chose', async () => {
    const backend = scriptSinopiaBackend({}, { views: 'genera' });
    const vista = await generaVista(principale, { ...opzioni, requestId: '11111111-1111-4111-8111-111111111111' });
    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]).toMatchObject({ method: 'POST', path: '/v1/views' });
    expect(backend.calls[0]!.body).toStrictEqual({
      requestId: '11111111-1111-4111-8111-111111111111',
      maxCreditCost: 2,
      versione: 1,
      ruolo: 'principale',
      famiglia: 'fibbia',
      schedaParte: schedaParteDiProva,
    });
    expect(vista).toMatchObject({ ruolo: 'principale', faccia: 'fianco_esterno', mediaType: 'image/png', costo: 2 });
    expect(vista.percorso.path).toBe(
      `projects/${schedaParteDiProva.progetto.id}/canvas-gen/11111111-1111-4111-8111-111111111111-isolate-part.png`,
    );
  });

  it('should send the control view with the main view’s asset and the index of the control', async () => {
    const backend = scriptSinopiaBackend({}, { views: 'genera' });
    await generaVista(
      { ruolo: 'controllo', famiglia: 'tacco', schedaParte: schedaParteDiProva, principale: { assetId: 'a' } },
      { ...opzioni, requestId: '22222222-2222-4222-8222-222222222222' },
    );
    expect(backend.calls[0]!.body).toMatchObject({
      ruolo: 'controllo',
      indiceControllo: 0,
      principale: { assetId: 'a' },
    });
  });

  it('should not call the function while the price of a view is not active', async () => {
    const backend = scriptSinopiaBackend({}, { views: 'genera' });
    await expect(
      generaVista(principale, {
        base,
        prezzo: async () => undefined,
        requestId: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toMatchObject({ codice: 'CREDITS_NOT_CONFIGURED' });
    expect(backend.calls).toHaveLength(0);
  });

  it.each([
    ['an old function without the route (404)', 'assente', 'ROUTE_MISSING'],
    ['a part without views', { errore: 'VIEWS_NOT_APPLICABLE', stato: 422 }, 'VIEWS_NOT_APPLICABLE'],
    ['a price not configured', { errore: 'CREDITS_NOT_CONFIGURED', stato: 503 }, 'CREDITS_NOT_CONFIGURED'],
    ['a source no longer readable', { errore: 'VIEW_SOURCE_UNAVAILABLE', stato: 409 }, 'VIEW_SOURCE_UNAVAILABLE'],
    ['a refusal of the generator', { errore: 'VIEW_REFUSED', stato: 422 }, 'VIEW_REFUSED'],
  ] as const)('should go on without views after %s', async (_caso, views, codice) => {
    scriptSinopiaBackend({}, { views });
    const errore = await generaVista(principale, {
      ...opzioni,
      requestId: '44444444-4444-4444-8444-444444444444',
    }).then(
      () => expect.fail('should have thrown'),
      (motivo: unknown) => motivo,
    );
    expect(errore).toBeInstanceOf(ErroreVista);
    expect((errore as ErroreVista).codice).toBe(codice);
    expect(decisioneVista(errore as ErroreVista)).toBe('senza_viste');
  });

  it('should stop on credits, ask again on a new price and offer a retry when the generator is down', () => {
    const decidi = (codice: ConstructorParameters<typeof ErroreVista>[0]) =>
      decisioneVista(new ErroreVista(codice, 0, codice));
    expect(decidi('INSUFFICIENT_CREDITS')).toBe('crediti_insufficienti');
    expect(decidi('CREDIT_COST_CHANGED')).toBe('riconferma_prezzo');
    expect(decidi('REQUEST_IN_PROGRESS')).toBe('riprova');
    expect(decidi('PROVIDER_UNAVAILABLE')).toBe('riprova_o_senza');
    expect(decidi('PROVIDER_SPEND_BLOCKED')).toBe('riprova_o_senza');
    expect(decidi('CAD_PILOT_NOT_ALLOWED')).toBe('accesso');
  });

  it('should read the retry delay of a view still being generated', async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { error: { type: 'REQUEST_IN_PROGRESS', message: 'in corso' } },
        { status: 409, headers: { 'retry-after': '10' } },
      ),
    );
    await expect(
      generaVista(principale, { ...opzioni, fetch, requestId: '55555555-5555-4555-8555-555555555555' }),
    ).rejects.toMatchObject({ codice: 'REQUEST_IN_PROGRESS', stato: 409, riprovaDopo: 10 });
  });

  it('should refuse an answer for another role as invalid', async () => {
    const fetch = vi.fn(async () => Response.json(sinopiaFakeView({ ruolo: 'controllo' })));
    await expect(
      generaVista(principale, { ...opzioni, fetch, requestId: '66666666-6666-4666-8666-666666666666' }),
    ).rejects.toMatchObject({ codice: 'VIEW_INVALID' });
  });
});

describe('the views of a visit are booked once per round', () => {
  it('should repeat the same request id on a reload, round 2 included, and a new one per round', async () => {
    const ids: string[] = [];
    const registra = async (requestId: string): Promise<string> => {
      ids.push(requestId);
      return requestId;
    };
    await vistaUnaVolta(chiaveVista('visita', 0, 'principale'), registra);
    await vistaUnaVolta(chiaveVista('visita', 0, 'principale'), registra);
    await vistaUnaVolta(chiaveVista('visita', 0, 'controllo'), registra);
    await vistaUnaVolta(chiaveVista('visita', 1, 'principale'), registra);
    await vistaUnaVolta(chiaveVista('visita', 1, 'principale'), registra);
    expect(ids[1]).toBe(ids[0]);
    expect(new Set([ids[0], ids[2], ids[3]]).size).toBe(3);
    expect(ids[4]).toBe(ids[3]);
  });

  it('should replace an id Sinopia no longer accepts once, and only once', async () => {
    const ids: string[] = [];
    const conflitto = async (requestId: string): Promise<never> => {
      ids.push(requestId);
      throw new ErroreVista('AI_REQUEST_CONFLICT', 409, 'già usata');
    };
    await expect(vistaUnaVolta(chiaveVista('visita', 0, 'principale'), conflitto)).rejects.toMatchObject({
      codice: 'AI_REQUEST_CONFLICT',
    });
    expect(ids).toHaveLength(2);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('should keep the round and the confirmation of the visit across a reload', () => {
    expect(statoVisita.leggi('visita')).toStrictEqual({ giro: 0, confermata: false });
    statoVisita.scrivi('visita', { giro: 2, confermata: true });
    expect(statoVisita.leggi('visita')).toStrictEqual({ giro: 2, confermata: true });
    sessionStorage.setItem('sinopiacad:viste:visita:giro', '{"giro":-1}');
    expect(statoVisita.leggi('visita')).toStrictEqual({ giro: 0, confermata: false });
  });
});

describe('the main view of the «Parte isolata» card', () => {
  const progetto = '1841f9d7-ee9a-4684-a6d0-742ba0e64b52';
  const vista = '0b5e4c3a-1d2f-4a6b-8c9d-0e1f2a3b4c5d';
  const attesa = { progettoId: progetto, parteId: 'heel', famiglia: 'tacco', facce: ['fianco_esterno'] };
  /* eslint-disable @typescript-eslint/naming-convention -- Colonne di Supabase. */
  const riga = (metadata: unknown) => ({
    id: vista,
    storage_bucket: 'creator-private',
    storage_path: `projects/${progetto}/canvas-gen/x-isolate-part.png`,
    metadata,
  });
  /* eslint-enable @typescript-eslint/naming-convention -- Di nuovo camelCase. */
  const buona = {
    part: {
      id: 'heel',
      name: 'Tacco',
      vista: { versione: 1, ruolo: 'principale', famiglia: 'tacco', faccia: 'fianco_esterno' },
    },
  };

  it('should read `view` from the link only as a uuid', () => {
    const link = (view: string) =>
      leggiParametriNuovo(new URLSearchParams({ project: progetto, asset: vista, part: 'heel', view }), {
        prove: false,
      });
    expect(link(vista.toUpperCase())).toMatchObject({ stato: 'parte', parametri: { vista } });
    expect(link('../altro')).toMatchObject({ stato: 'parte' });
    expect((link('../altro') as { parametri: object }).parametri).not.toHaveProperty('vista');
  });

  it('should reuse a main view of the same part and family', () => {
    expect(vistaRiusabile(riga(buona), attesa)).toStrictEqual({
      assetId: vista,
      progettoId: progetto,
      faccia: 'fianco_esterno',
      percorso: { bucket: 'creator-private', path: `projects/${progetto}/canvas-gen/x-isolate-part.png` },
    });
  });

  it.each([
    ['an old three-quarter card without metadata', { part: { id: 'heel', name: 'Tacco' } }],
    ['another part', { part: { ...buona.part, id: 'sole' } }],
    ['another family', { part: { ...buona.part, vista: { ...buona.part.vista, famiglia: 'fondo_semplice' } } }],
    ['a control view', { part: { ...buona.part, vista: { ...buona.part.vista, ruolo: 'controllo' } } }],
    ['a face that is not a main one', { part: { ...buona.part, vista: { ...buona.part.vista, faccia: 'dietro' } } }],
    ['no metadata at all', null],
  ])('should ignore %s', (_caso, metadata) => {
    expect(vistaRiusabile(riga(metadata), attesa)).toBeUndefined();
  });
});
