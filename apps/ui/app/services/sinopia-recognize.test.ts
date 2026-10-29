// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { base64ToUint8Array } from 'uint8array-extras';
import { schedaParteDiProva, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import type { MisureFoto } from '@taucad/smlib/riconoscimento';
import { ErroreRiconoscimento, riconosciParte, riconoscimentoRegistrato } from '#services/sinopia-recognize.js';
import type { VistaPerRiconoscimento } from '#services/sinopia-recognize.js';
import { mascheraDellaVista, svuotaFori, vistaPerRiconoscimento } from '#services/riconoscimento-immagini.js';
import type { ImmaginiRiconoscimento } from '#services/riconoscimento-immagini.js';

vi.mock('#environment.config.js', () => ({
  requireClientEnvironment: () => 'https://sinopia.test/functions/v1/sinopiacad/',
}));
vi.mock('#lib/sinopia-data-client.js', () => ({
  requireSinopiaUser: async () => ({ userId: 'u', token: 'jwt-of-the-user' }),
}));
vi.mock('#services/sinopia-foto.js', () => ({ leggiPrezziCad: async () => ({ cad_recognize: 2 }) }));
vi.mock('#lib/sinopia-session.js', () => ({ readSinopiaConfig: () => undefined }));

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
    // The body with the views can be too large: the page offers the photo alone instead of a dead end.
    await expect(
      riconosciParte(richiesta, {
        fetch: risponde(
          Response.json({ error: { type: 'REQUEST_TOO_LARGE', message: 'troppo grande' } }, { status: 413 }),
        ),
      }),
    ).rejects.toMatchObject({ codice: 'REQUEST_TOO_LARGE', stato: 413 });
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

describe('recognition with the generated views (contract v3)', () => {
  const principale: VistaPerRiconoscimento = {
    ruolo: 'principale',
    faccia: 'sopra',
    mediaType: 'image/png',
    data: 'iVBORw0KGgo=',
  };
  const controllo: VistaPerRiconoscimento = {
    ruolo: 'controllo',
    faccia: 'fianco_esterno',
    mediaType: 'image/webp',
    data: 'UklGRg==',
  };
  const misure: MisureFoto = {
    proporzioni: {
      rapporti: [{ chiave: 'altezza_su_lunghezza', valore: 0.2 }],
      affidabilita: 0.8,
      parti: 3,
    },
    visibilita: { stato: 'intera', motivi: [] },
  };
  const leggiCorpo = (risposta: unknown) => {
    const corpi: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      corpi.push(JSON.parse(init!.body as string) as Record<string, unknown>);
      return Response.json(risposta);
    }) as unknown as typeof globalThis.fetch;
    return { corpi, fetch };
  };

  it('should send both views after the two pictures, with their roles in the context and version 3', async () => {
    const { corpi, fetch } = leggiCorpo({ ...riconoscimentoRegistrato(), versione: 3 });
    const esito = await riconosciParte(
      { schedaParte: schedaParteDiProva, immagini, lingua: 'it', viste: [controllo, principale], misure },
      { fetch, prezzo: async () => 2, requestId: '77777777-7777-4777-8777-777777777777' },
    );
    expect(corpi[0]).toStrictEqual({
      requestId: '77777777-7777-4777-8777-777777777777',
      maxCreditCost: 2,
      schedaParte: schedaParteDiProva,
      immagini: {
        ritaglio: immagini.ritaglio,
        intera: immagini.intera,
        principale: { mediaType: 'image/png', data: 'iVBORw0KGgo=' },
        controllo: { mediaType: 'image/webp', data: 'UklGRg==' },
      },
      fattoreRitaglio: 1.39,
      lingua: 'it',
      versioneContratto: 3,
      contesto: {
        versione: 1,
        proporzioni: misure.proporzioni,
        visibilita: misure.visibilita,
        viste: [
          { ruolo: 'controllo', faccia: 'fianco_esterno' },
          { ruolo: 'principale', faccia: 'sopra' },
        ],
      },
    });
    expect(esito.versione).toBe(3);
    expect(esito.visteUsate).toBe(true);
  });

  it('should accept the v2 answer of a function not yet updated and mark the views as not used', async () => {
    const { fetch } = leggiCorpo(riconoscimentoRegistrato());
    const esito = await riconosciParte(
      { schedaParte: schedaParteDiProva, immagini, lingua: 'it', viste: [principale] },
      { fetch, prezzo: async () => 2 },
    );
    expect(esito.versione).toBe(2);
    expect(esito.visteUsate).toBe(false);
  });

  it('should keep today’s v2 body without views and measures', async () => {
    const { corpi, fetch } = leggiCorpo(riconoscimentoRegistrato());
    const esito = await riconosciParte(
      { schedaParte: schedaParteDiProva, immagini, lingua: 'en', viste: [] },
      { fetch, prezzo: async () => 2, requestId: '88888888-8888-4888-8888-888888888888' },
    );
    expect(Object.keys(corpi[0]!).toSorted()).toStrictEqual(
      ['fattoreRitaglio', 'immagini', 'lingua', 'maxCreditCost', 'requestId', 'schedaParte'].toSorted(),
    );
    expect(esito).not.toHaveProperty('visteUsate');
  });

  it('should send the bytes of a view exactly as they were downloaded', async () => {
    const byte = Uint8Array.from({ length: 300 }, (_valore, indice) => (indice * 37) % 256);
    const vista = await vistaPerRiconoscimento(new Blob([byte], { type: 'image/png' }), 'principale', 'sopra');
    expect(vista.mediaType).toBe('image/png');
    expect(base64ToUint8Array(vista.data)).toStrictEqual(byte);
  });
});

describe('mask of a generated view', () => {
  /** Un riquadro scuro al centro di un fondo bianco uniforme, 40 × 40 px. */
  const pixelVista = (): Uint8ClampedArray => {
    const rgba = new Uint8ClampedArray(40 * 40 * 4).fill(255);
    for (let y = 12; y < 28; y++) {
      for (let x = 8; x < 32; x++) {
        rgba.set([40, 30, 20, 255], (y * 40 + x) * 4);
      }
    }
    return rgba;
  };

  it('should cut the part out of the plain background for free, without asking SAM', async () => {
    const segmenta = vi.fn(async () => new Blob([Uint8Array.of(9)]));
    let accese = 0;
    const maschera = await mascheraDellaVista(
      new Blob([Uint8Array.of(1)], { type: 'image/png' }),
      {
        pixel: async () => ({ larghezza: 40, altezza: 40, rgba: pixelVista() }),
        codificaMaschera: async (binaria) => {
          accese = binaria.dati.reduce((somma, valore) => somma + valore, 0);
          return new Blob([Uint8Array.of(0x89, 0x50)]);
        },
        segmenta,
      },
      'tacco',
    );
    expect(maschera?.origine).toBe('sfondo');
    expect(maschera?.png).toStrictEqual(Uint8Array.of(0x89, 0x50));
    expect(accese).toBe(16 * 24);
    expect(segmenta).not.toHaveBeenCalled();
  });

  it('should open the hole of a buckle frame that shows the same plain background', () => {
    // A 20 × 20 frame (x, y 10–29) on white with a 10 × 10 opening (x, y 15–24) of the same white.
    const rgba = new Uint8ClampedArray(40 * 40 * 4).fill(255);
    const dati = new Uint8Array(40 * 40);
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) {
        dati[y * 40 + x] = 1;
        if (!(x >= 15 && x < 25 && y >= 15 && y < 25)) {
          rgba.set([120, 90, 40, 255], (y * 40 + x) * 4);
        }
      }
    }
    const maschera = svuotaFori({ larghezza: 40, altezza: 40, dati }, rgba);
    expect(maschera.dati[20 * 40 + 20]).toBe(0);
    expect(maschera.dati[12 * 40 + 12]).toBe(1);
    expect(maschera.dati.reduce((somma, valore) => somma + valore, 0)).toBe(400 - 100);
  });

  it('should fall back on SAM when the background is not plain', async () => {
    const rumore = Uint8ClampedArray.from({ length: 40 * 40 * 4 }, (_valore, indice) => (indice * 97) % 256);
    const segmenta = vi.fn(async () => new Blob([Uint8Array.of(7, 7)]));
    const maschera = await mascheraDellaVista(
      new Blob([Uint8Array.of(1)]),
      {
        pixel: async () => ({ larghezza: 40, altezza: 40, rgba: rumore }),
        codificaMaschera: async () => new Blob([]),
        segmenta,
      },
      'tacco nero',
    );
    expect(segmenta).toHaveBeenCalledWith(expect.any(Blob), 'tacco nero');
    expect(maschera).toStrictEqual({ png: Uint8Array.of(7, 7), origine: 'sam' });
  });
});
