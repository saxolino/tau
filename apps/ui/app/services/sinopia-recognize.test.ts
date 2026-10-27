// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { schedaParteDiProva, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import { ErroreRiconoscimento, riconosciParte, riconoscimentoRegistrato } from '#services/sinopia-recognize.js';
import type { ImmaginiRiconoscimento } from '#services/riconoscimento-immagini.js';

vi.mock('#environment.config.js', () => ({
  requireClientEnvironment: () => 'https://sinopia.test/functions/v1/sinopiacad/',
}));
vi.mock('#lib/sinopia-data-client.js', () => ({
  requireSinopiaUser: async () => ({ userId: 'u', token: 'jwt-of-the-user' }),
}));
vi.mock('#services/sinopia-foto.js', () => ({ leggiPrezziCad: async () => ({ cad_recognize: 2 }) }));

const immagini: ImmaginiRiconoscimento = {
  ritaglio: { mediaType: 'image/jpeg', data: '/9j/4AAQ' },
  intera: { mediaType: 'image/jpeg', data: '/9j/4AAQ' },
  fattoreRitaglio: 1.39,
};

describe('client of /v1/recognize', () => {
  it('should post the sheet and the pictures with the session token and validate the answer', async () => {
    const chiamate: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      chiamate.push({ url, init: init ?? {} });
      return Response.json(riconoscimentoRegistrato());
    }) as unknown as typeof globalThis.fetch;
    const esito = await riconosciParte(
      { schedaParte: schedaParteDiProva, immagini, lingua: 'it' },
      { fetch, progettoCad: 'proj_1', prezzo: async () => 2, requestId: '44444444-4444-4444-8444-444444444444' },
    );
    expect(esito.scheda).toStrictEqual(schedaRiconoscimentoDiProva);
    expect(chiamate[0]!.url).toBe('https://sinopia.test/functions/v1/sinopiacad/v1/recognize');
    const headers = chiamate[0]!.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer jwt-of-the-user');
    expect(headers['x-tau-project-id']).toBe('proj_1');
    expect(JSON.parse(chiamate[0]!.init.body as string)).toStrictEqual({
      requestId: '44444444-4444-4444-8444-444444444444',
      maxCreditCost: 2,
      schedaParte: schedaParteDiProva,
      immagini: { ritaglio: immagini.ritaglio, intera: immagini.intera },
      fattoreRitaglio: 1.39,
      lingua: 'it',
    });
  });

  it('should accept an answer of the function not yet updated (version 1, no face), completing the face', async () => {
    const { faccia: _faccia, ...vista } = schedaRiconoscimentoDiProva.vista;
    const vecchia = { ...riconoscimentoRegistrato(), versione: 1, scheda: { ...schedaRiconoscimentoDiProva, vista } };
    const fetch = vi.fn(async () => Response.json(vecchia)) as unknown as typeof globalThis.fetch;
    const esito = await riconosciParte(
      { schedaParte: schedaParteDiProva, immagini, lingua: 'it' },
      { fetch, progettoCad: 'proj_1', prezzo: async () => 2, requestId: '55555555-5555-4555-8555-555555555555' },
    );
    expect(esito.versione).toBe(1);
    expect(esito.scheda.vista).toMatchObject({ nome: vista.nome, faccia: 'sopra' });
  });

  it('should send the second round as `immagini.differenza`, the field the function reads', async () => {
    let corpo: unknown;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      corpo = JSON.parse(init!.body as string);
      return Response.json(riconoscimentoRegistrato());
    }) as unknown as typeof globalThis.fetch;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await riconosciParte(
      {
        schedaParte: schedaParteDiProva,
        immagini,
        lingua: 'it',
        rientro: { differenzaPng: png, testo: 'x', iou: 0.8 },
      },
      { fetch },
    );
    expect(corpo).toMatchObject({
      immagini: { ritaglio: immagini.ritaglio, differenza: { mediaType: 'image/png', data: 'iVBORw0KGgo=' } },
    });
    expect(corpo).not.toHaveProperty('rientro');
  });

  it('should turn the function’s errors and a malformed answer into typed errors', async () => {
    const risponde = (risposta: Response) => (async () => risposta) as unknown as typeof globalThis.fetch;
    const richiesta: Parameters<typeof riconosciParte>[0] = { schedaParte: schedaParteDiProva, immagini, lingua: 'it' };
    await expect(
      riconosciParte(richiesta, {
        fetch: risponde(Response.json({ error: { type: 'RECOGNITION_REFUSED', message: 'no' } }, { status: 422 })),
      }),
    ).rejects.toMatchObject({ codice: 'RECOGNITION_REFUSED', stato: 422 });
    await expect(
      riconosciParte(richiesta, {
        fetch: risponde(
          Response.json({ error: { type: 'BILLING_ACCOUNT_RESTRICTED', message: 'pilota' } }, { status: 403 }),
        ),
      }),
    ).rejects.toMatchObject({ codice: 'BILLING_ACCOUNT_RESTRICTED' });
    const rotta = {
      ...riconoscimentoRegistrato(),
      scheda: { ...schedaRiconoscimentoDiProva, famiglia: { id: 'scarpa' } },
    };
    await expect(riconosciParte(richiesta, { fetch: risponde(Response.json(rotta)) })).rejects.toBeInstanceOf(
      ErroreRiconoscimento,
    );
    const rete = (async () => {
      throw new TypeError('offline');
    }) as unknown as typeof globalThis.fetch;
    await expect(riconosciParte(richiesta, { fetch: rete })).rejects.toMatchObject({ codice: 'NETWORK' });
  });

  it('should not call the function while the price of a recognition is not active, and type the credit errors', async () => {
    const fetch = vi.fn(async () => Response.json(riconoscimentoRegistrato())) as unknown as typeof globalThis.fetch;
    const richiesta: Parameters<typeof riconosciParte>[0] = { schedaParte: schedaParteDiProva, immagini, lingua: 'it' };
    await expect(riconosciParte(richiesta, { fetch, prezzo: async () => undefined })).rejects.toMatchObject({
      codice: 'CREDITS_NOT_CONFIGURED',
    });
    expect(fetch).not.toHaveBeenCalled();
    const pochi = (async () =>
      Response.json(
        { error: { type: 'INSUFFICIENT_CREDITS', message: 'Crediti insufficienti' } },
        { status: 402 },
      )) as unknown as typeof globalThis.fetch;
    await expect(riconosciParte(richiesta, { fetch: pochi })).rejects.toMatchObject({
      codice: 'INSUFFICIENT_CREDITS',
      stato: 402,
    });
    let corpo: Record<string, unknown> = {};
    const legge = (async (_url: string, init?: RequestInit) => {
      corpo = JSON.parse(init!.body as string) as Record<string, unknown>;
      return Response.json(riconoscimentoRegistrato());
    }) as unknown as typeof globalThis.fetch;
    await riconosciParte(richiesta, { fetch: legge });
    expect(corpo['maxCreditCost']).toBe(2);
    expect(corpo['requestId']).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u);
  });
});
