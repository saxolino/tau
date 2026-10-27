// @vitest-environment node
/* eslint-disable @typescript-eslint/naming-convention -- Fake PostgREST responses keep Supabase column names. */
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MascheraBinaria } from '@taucad/smlib/riconoscimento';
import {
  caricaSchedaParte,
  chiaveRiconosciuta,
  ErroreParte,
  improntaDeiByte,
  leggiMisura,
  leggiParametriNuovo,
  orientaContorno,
  partTypeDaParole,
  rasterizzaContorno,
  scegliFileMaschera,
  segmentoSicuro,
} from '#services/sinopia-parts.js';
import type { StrumentiParti } from '#services/sinopia-parts.js';

const PROGETTO = '0f9d7a8e-5b1c-4c2d-9e3f-1a2b3c4d5e6f';
const ASSET = '6b7c8d9e-1f2a-4b3c-8d4e-5f6a7b8c9d0e';
const UTENTE = '11111111-1111-4111-8111-111111111111';
const IMMAGINE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const base = 'https://sinopia.test';
const data = new Map<string, unknown>();
const elenchi = new Map<string, unknown>();
const scaricati: string[] = [];
const client = createClient(base, 'public-test-key', {
  accessToken: async () => 'user-jwt',
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.startsWith('/storage/v1/object/list/')) {
        const corpo = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as { prefix: string };
        return Response.json(elenchi.get(corpo.prefix) ?? []);
      }
      if (url.pathname.includes('/storage/v1/object/')) {
        scaricati.push(decodeURIComponent(url.pathname));
        return new Response(IMMAGINE, { headers: { 'Content-Type': 'image/png' } });
      }
      return Response.json(data.get(url.pathname) ?? []);
    },
  },
});
vi.mock('#environment.config.js', () => ({ ENV: { SINOPIA_SUPABASE_URL: 'https://sinopia.test' } }));
vi.mock('#lib/sinopia-data-client.js', () => ({ getSinopiaDataClient: async () => ({ client, userId: UTENTE }) }));

const strumenti = (): StrumentiParti & { codificate: MascheraBinaria[] } => {
  const codificate: MascheraBinaria[] = [];
  return {
    codificate,
    dimensioni: async () => ({ larghezza: 100, altezza: 80 }),
    decodificaMaschera: async (_png, larghezza, altezza) => {
      const dati = new Uint8Array(larghezza * altezza);
      for (let y = 20; y < 60; y++) {
        dati.fill(1, y * larghezza + 30, y * larghezza + 70);
      }
      return { larghezza, altezza, dati };
    },
    codificaMaschera: async (maschera) => {
      codificate.push(maschera);
      return new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    },
  };
};

const parte = {
  id: 'fibbia',
  nome: 'Fibbia',
  etichetta: 'Fibbia del cinturino',
  materiale: 'ottone',
  box: [300, 250, 700, 750],
  // Gemini's [y, x]: swapped back onto the box.
  contorno: [
    [250, 300],
    [250, 700],
    [750, 700],
    [750, 300],
  ],
};

beforeEach(() => {
  data.clear();
  elenchi.clear();
  scaricati.length = 0;
  data.set('/rest/v1/projects', [{ id: PROGETTO, vertical: 'footwear' }]);
  data.set('/rest/v1/assets', [
    {
      id: ASSET,
      user_id: UTENTE,
      project_id: PROGETTO,
      type: 'ai_render',
      storage_bucket: 'creator-private',
      storage_path: `projects/${PROGETTO}/render.png`,
    },
  ]);
  data.set('/rest/v1/recognized_parts_cache', [
    {
      parts: [parte, { id: 'cinturino', nome: 'Cinturino', etichetta: 'Cinturino', box: [0, 400, 1000, 600] }],
      vertical: 'footwear',
      language: 'it',
    },
  ]);
});

describe('«/cad/nuovo» address', () => {
  const indirizzo = (resto: string) => new URLSearchParams(`project=${PROGETTO}&asset=${ASSET}&part=fibbia${resto}`);

  it('should read project, asset and part, and keep only well-formed optional parameters', () => {
    expect(
      leggiParametriNuovo(indirizzo('&partType=buckle&measure=20:luce&library=nope&mask=../../x.png'), {
        prove: false,
      }),
    ).toStrictEqual({
      stato: 'parte',
      parametri: {
        progetto: PROGETTO,
        asset: ASSET,
        parte: 'fibbia',
        partType: 'buckle',
        misura: { valoreMm: 20, cosa: 'luce' },
      },
    });
    const maschera = `users/${UTENTE}/maschere-parti/${'a'.repeat(64)}/riconosciute/fibbia.300-250-700-750.sam.png`;
    expect(leggiParametriNuovo(indirizzo(`&mask=${encodeURIComponent(maschera)}`), { prove: false })).toMatchObject({
      parametri: { maschera },
    });
    expect(leggiParametriNuovo(new URLSearchParams(`project=${PROGETTO}&part=fibbia`), { prove: false })).toStrictEqual(
      { stato: 'incompleto' },
    );
    expect(leggiParametriNuovo(new URLSearchParams('prova=fibbia'), { prove: true })).toStrictEqual({
      stato: 'prova',
      famigliaIncerta: false,
    });
    expect(leggiParametriNuovo(new URLSearchParams('prova=fibbia-incerta'), { prove: true })).toMatchObject({
      famigliaIncerta: true,
    });
    expect(leggiParametriNuovo(new URLSearchParams('prova=fibbia'), { prove: false })).toStrictEqual({
      stato: 'incompleto',
    });
  });

  it('should structure a known measure in both writings', () => {
    expect(leggiMisura('20:larghezza')).toStrictEqual({ valoreMm: 20, cosa: 'larghezza' });
    expect(leggiMisura('20,5 mm: altezza tacco')).toStrictEqual({ valoreMm: 20.5, cosa: 'altezza tacco' });
    expect(leggiMisura('85')).toStrictEqual({ valoreMm: 85, cosa: 'lato lungo' });
    expect(leggiMisura('abc:x')).toBeUndefined();
    expect(leggiMisura('-3:x')).toBeUndefined();
    expect(leggiMisura(undefined)).toBeUndefined();
  });
});

describe('Sinopia part helpers (copies of the Studio’s)', () => {
  // The same cases as Sinopia's `parti-riconosciute.test.ts`, measured on the real shoe on 10 October.
  const PUNTALE_BOX = [695, 527, 876, 722] as const;
  const PUNTALE_CONTORNO: Array<[number, number]> = [
    [529, 740],
    [584, 825],
    [642, 874],
    [701, 804],
    [719, 715],
  ];

  it('should orient Gemini’s outlines on the box as Sinopia does', () => {
    expect(orientaContorno(PUNTALE_CONTORNO, PUNTALE_BOX)).toStrictEqual(PUNTALE_CONTORNO.map(([a, b]) => [b, a]));
    const giusto: Array<[number, number]> = [
      [715, 529],
      [874, 560],
      [800, 719],
    ];
    expect(orientaContorno(giusto, PUNTALE_BOX)).toBe(giusto);
    const quadrato: Array<[number, number]> = [
      [122, 126],
      [881, 600],
      [877, 877],
    ];
    expect(orientaContorno(quadrato, [100, 100, 900, 900])).toBe(quadrato);
    expect(
      orientaContorno(
        [
          [122, 126],
          [881, 600],
          [877, 877],
          [500, 126],
        ],
        [119, 595, 893, 878],
      ),
    ).toBeUndefined();
    expect(orientaContorno([], PUNTALE_BOX)).toBeUndefined();
  });

  it('should rasterise an outline at the picture’s size', () => {
    const maschera = rasterizzaContorno(
      [
        [100, 100],
        [600, 100],
        [600, 600],
        [100, 600],
      ],
      10,
      10,
    );
    expect(maschera.dati.reduce((somma, v) => somma + v, 0)).toBe(25);
    expect(maschera.dati[1 * 10 + 1]).toBe(1);
    expect(maschera.dati[6 * 10 + 6]).toBe(0);
  });

  it('should name and choose the saved masks like the Studio’s deposit', () => {
    expect(segmentoSicuro('tacco.alto~1')).toBe('tacco_2Ealto_7E1');
    const chiave = chiaveRiconosciuta({ id: 'fibbia', box: [300.4, 250, 700, 749.6] });
    expect(chiave).toBe('fibbia.300-250-700-750');
    expect(
      scegliFileMaschera(
        [`${chiave}.vuota.png`, `${chiave}.contorno.png`, `${chiave}.sam.png`, 'altro.sam.png'],
        chiave,
      ),
    ).toStrictEqual({
      nome: `${chiave}.sam.png`,
      origine: 'sam',
    });
    expect(scegliFileMaschera([`${chiave}.vuota.png`], chiave)).toBeUndefined();
  });

  it('should suggest a part type from the part’s words', () => {
    expect(partTypeDaParole({ id: 'tacco', nome: 'Tacco', etichetta: 'Tacco a spillo' })).toBe('heel');
    expect(partTypeDaParole({ id: 'tappo', nome: 'Tappo', etichetta: 'Sopratacco' })).toBe('top_lift');
    expect(partTypeDaParole({ id: 'tomaia', nome: 'Tomaia', etichetta: 'Tomaia' })).toBe('leather');
    expect(partTypeDaParole({ id: 'x', nome: 'Nappina', etichetta: 'Nappina' })).toBeUndefined();
  });
});

describe('reading the part sheet from Sinopia', () => {
  it('should find the saved SAM mask, take the catalogue type and the measure, and orient the outline', async () => {
    const impronta = await improntaDeiByte(IMMAGINE);
    const cartella = `users/${UTENTE}/maschere-parti/${impronta}/riconosciute`;
    elenchi.set(cartella, [{ name: 'fibbia.300-250-700-750.sam.png' }, { name: 'fibbia.300-250-700-750.vuota.png' }]);
    const caricata = await caricaSchedaParte(
      {
        progetto: PROGETTO,
        asset: ASSET,
        parte: 'fibbia',
        partType: 'buckle',
        misura: { valoreMm: 20, cosa: 'larghezza' },
      },
      strumenti(),
    );
    expect(caricata.schedaParte).toMatchObject({
      progetto: { id: PROGETTO, verticale: 'footwear' },
      immagine: {
        bucket: 'creator-private',
        path: `projects/${PROGETTO}/render.png`,
        sha256: impronta,
        larghezzaPx: 100,
        altezzaPx: 80,
      },
      parte: {
        id: 'fibbia',
        contorno: [
          [300, 250],
          [700, 250],
          [700, 750],
          [300, 750],
        ],
      },
      maschera: { origine: 'sam', path: `${cartella}/fibbia.300-250-700-750.sam.png` },
      tipo: { partType: 'buckle', fonte: 'catalogo' },
      // 40 px of mask width for 20 mm.
      scala: { tipo: 'misura', valoreMm: 20, pxPerMm: 2, confidenza: 0.95 },
      altreParti: [{ id: 'cinturino', etichetta: 'Cinturino' }],
    });
    expect(scaricati.some((path) => path.endsWith('fibbia.300-250-700-750.sam.png'))).toBe(true);
  });

  it('should rasterise the outline when no mask is saved, and suggest the type from the words', async () => {
    const attrezzi = strumenti();
    const caricata = await caricaSchedaParte({ progetto: PROGETTO, asset: ASSET, parte: 'fibbia' }, attrezzi);
    expect(caricata.schedaParte.maschera?.origine).toBe('contorno');
    expect(caricata.schedaParte.tipo).toStrictEqual({ partType: 'buckle', fonte: 'riconosci_parti' });
    expect(attrezzi.codificate).toHaveLength(1);
    expect(caricata.maschera.dati.reduce((somma, v) => somma + v, 0)).toBe(40 * 40);
  });

  it('should say what is missing: the part, the analysis, or any mask', async () => {
    await expect(
      caricaSchedaParte({ progetto: PROGETTO, asset: ASSET, parte: 'tacco' }, strumenti()),
    ).rejects.toMatchObject({
      codice: 'parteAssente',
    });
    data.set('/rest/v1/recognized_parts_cache', [
      { parts: [{ ...parte, contorno: undefined }], vertical: 'footwear', language: 'it' },
    ]);
    await expect(
      caricaSchedaParte({ progetto: PROGETTO, asset: ASSET, parte: 'fibbia' }, strumenti()),
    ).rejects.toBeInstanceOf(ErroreParte);
    data.set('/rest/v1/recognized_parts_cache', []);
    await expect(
      caricaSchedaParte({ progetto: PROGETTO, asset: ASSET, parte: 'fibbia' }, strumenti()),
    ).rejects.toMatchObject({
      codice: 'partiAssenti',
    });
    data.set('/rest/v1/projects', []);
    await expect(
      caricaSchedaParte({ progetto: PROGETTO, asset: ASSET, parte: 'fibbia' }, strumenti()),
    ).rejects.toMatchObject({
      codice: 'progettoAssente',
    });
  });
});
