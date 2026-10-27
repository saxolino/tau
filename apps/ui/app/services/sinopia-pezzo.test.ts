// @vitest-environment node
/* eslint-disable @typescript-eslint/naming-convention -- Fake PostgREST responses keep Supabase column names. */
import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { caricaSchedaPezzo, mascheraDaSfondo, riquadroDellaMaschera } from '#services/sinopia-pezzo.js';
import type { StrumentiParti } from '#services/sinopia-parts.js';

const UTENTE = '11111111-1111-4111-8111-111111111111';
const LIBRERIA = '2a5c7e90-1b3d-4f5a-8c7e-9d0b1a2c3d4e';
const PRODOTTO = '3b6d8fa1-2c4e-4a6b-9d8f-0e1c2b3d4e5f';
const IMMAGINE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const base = 'https://sinopia.test';
const data = new Map<string, unknown>();
const client = createClient(base, 'public-test-key', {
  accessToken: async () => 'user-jwt',
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: async (input) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname.includes('/storage/v1/object/')) {
        return new Response(IMMAGINE, { headers: { 'Content-Type': 'image/png' } });
      }
      return Response.json(data.get(url.pathname) ?? []);
    },
  },
});
vi.mock('#environment.config.js', () => ({ ENV: { SINOPIA_SUPABASE_URL: 'https://sinopia.test' } }));
vi.mock('#lib/sinopia-data-client.js', () => ({ getSinopiaDataClient: async () => ({ client, userId: UTENTE }) }));

/** A 10×10 white picture with a 4×4 dark part at (3,3). */
const pixel = (disegna: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray => {
  const rgba = new Uint8ClampedArray(10 * 10 * 4);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      rgba.set(disegna(x, y), (y * 10 + x) * 4);
    }
  }
  return rgba;
};
const dentro = (x: number, y: number): boolean => x >= 3 && x < 7 && y >= 3 && y < 7;

describe('catalogue photo cut-out', () => {
  it('should cut the part from a plain background and fill its holes', () => {
    const rgba = pixel((x, y) => (dentro(x, y) && !(x === 4 && y === 4) ? [30, 30, 30, 255] : [250, 250, 250, 255]));
    const maschera = mascheraDaSfondo(rgba, 10, 10)!;
    expect(maschera.dati.reduce((somma, valore) => somma + valore, 0)).toBe(16);
    expect(maschera.dati[4 * 10 + 4]).toBe(1);
    expect(riquadroDellaMaschera(maschera)).toStrictEqual([300, 300, 700, 700]);
  });

  it('should cut the part from a transparent background', () => {
    const rgba = pixel((x, y) => (dentro(x, y) ? [200, 10, 10, 255] : [0, 0, 0, 0]));
    expect(mascheraDaSfondo(rgba, 10, 10)?.dati.reduce((somma, valore) => somma + valore, 0)).toBe(16);
  });

  it('should refuse a photo with no plain background or no part at all', () => {
    expect(
      mascheraDaSfondo(
        pixel((x) => [x * 25, 90, 255 - x * 25, 255]),
        10,
        10,
      ),
    ).toBeUndefined();
    expect(
      mascheraDaSfondo(
        pixel(() => [250, 250, 250, 255]),
        10,
        10,
      ),
    ).toBeUndefined();
  });
});

const strumenti = (conPixel: boolean, sam?: Blob): StrumentiParti & { sam: number } => {
  const stato = { sam: 0 };
  return {
    get sam() {
      return stato.sam;
    },
    dimensioni: async () => ({ larghezza: 10, altezza: 10 }),
    decodificaMaschera: async (_png, larghezza, altezza) => ({
      larghezza,
      altezza,
      dati: new Uint8Array(larghezza * altezza).fill(1, 20, 80),
    }),
    codificaMaschera: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    segmenta: async () => {
      stato.sam++;
      return sam;
    },
    ...(conPixel
      ? {
          pixel: async () => ({
            larghezza: 10,
            altezza: 10,
            rgba: pixel((x, y) => (dentro(x, y) ? [30, 30, 30, 255] : [250, 250, 250, 255])),
          }),
        }
      : {}),
  };
};

beforeEach(() => {
  data.clear();
  data.set('/rest/v1/library_components', [
    {
      id: LIBRERIA,
      name: 'Buckle',
      name_it: 'Fibbia ovale',
      type: 'buckle',
      image_url: `${base}/storage/v1/object/public/library-components/${UTENTE}/fibbia.png`,
      width_mm: 40,
      height_mm: null,
    },
  ]);
  data.set('/rest/v1/supplier_products', [{ id: PRODOTTO, name: 'Borchia conica', part_type: 'stud' }]);
  data.set('/rest/v1/supplier_product_images', [
    { url: `${base}/storage/v1/object/public/supplier-products/x/a.png`, is_primary: false, sort_order: 1 },
    { url: `${base}/storage/v1/object/public/supplier-products/x/b.png`, is_primary: true, sort_order: 2 },
  ]);
});

describe('part sheet of a Library or supplier piece', () => {
  it('should compose the sheet from the Library card: declared type, declared width as scale, background mask', async () => {
    const strum = strumenti(true);
    const caricata = await caricaSchedaPezzo({ origine: 'libreria', id: LIBRERIA }, strum);
    const { schedaParte } = caricata;
    expect(schedaParte.progetto).toStrictEqual({ id: LIBRERIA, verticale: 'accessories' });
    expect(schedaParte.parte).toMatchObject({
      nome: 'Fibbia ovale',
      etichetta: 'Fibbia ovale',
      box: [300, 300, 700, 700],
    });
    expect(schedaParte.tipo).toStrictEqual({ partType: 'buckle', fonte: 'libreria' });
    expect(schedaParte.maschera?.origine).toBe('contorno');
    expect(schedaParte.scala).toMatchObject({ tipo: 'libreria' });
    expect(caricata.scontornoDaSfondo).toBe(true);
    expect(strum.sam).toBe(0);
  });

  it('should take the catalogue type and the primary photo of a supplier product, and a measure from the address', async () => {
    const caricata = await caricaSchedaPezzo(
      { origine: 'fornitore', id: PRODOTTO, misura: { valoreMm: 12, cosa: 'larghezza' } },
      strumenti(true),
    );
    expect(caricata.schedaParte.tipo).toStrictEqual({ partType: 'stud', fonte: 'catalogo' });
    expect(caricata.schedaParte.scala).toMatchObject({ tipo: 'misura', valoreMm: 12 });
  });

  it('should fall back to SAM only when the background is not plain, and say so when nothing gives a mask', async () => {
    const sam = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    const conSam = strumenti(false, sam);
    const caricata = await caricaSchedaPezzo({ origine: 'libreria', id: LIBRERIA }, conSam);
    expect(conSam.sam).toBe(1);
    expect(caricata.schedaParte.maschera?.origine).toBe('sam');
    expect(caricata.scontornoDaSfondo).toBeUndefined();
    await expect(caricaSchedaPezzo({ origine: 'libreria', id: LIBRERIA }, strumenti(false))).rejects.toMatchObject({
      codice: 'mascheraAssente',
    });
  });

  it('should say clearly when the card does not exist or has no photo', async () => {
    data.set('/rest/v1/library_components', []);
    await expect(caricaSchedaPezzo({ origine: 'libreria', id: LIBRERIA }, strumenti(true))).rejects.toMatchObject({
      codice: 'pezzoAssente',
    });
    data.set('/rest/v1/supplier_product_images', []);
    await expect(caricaSchedaPezzo({ origine: 'fornitore', id: PRODOTTO }, strumenti(true))).rejects.toMatchObject({
      codice: 'immagineAssente',
    });
  });
});
