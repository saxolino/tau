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
      { fetch, progettoCad: 'proj_1' },
    );
    expect(esito.scheda).toStrictEqual(schedaRiconoscimentoDiProva);
    expect(chiamate[0]!.url).toBe('https://sinopia.test/functions/v1/sinopiacad/v1/recognize');
    const headers = chiamate[0]!.init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer jwt-of-the-user');
    expect(headers['x-tau-project-id']).toBe('proj_1');
    expect(JSON.parse(chiamate[0]!.init.body as string)).toStrictEqual({
      schedaParte: schedaParteDiProva,
      immagini: { ritaglio: immagini.ritaglio, intera: immagini.intera },
      fattoreRitaglio: 1.39,
      lingua: 'it',
    });
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
});
