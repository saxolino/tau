/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { crc32, deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { momenti, preparaMaschera, preparaMascheraPng } from '#verifica/maschera.js';
import { codificaPng, decodificaPng } from '#verifica/png.js';
import type { ImmagineRaster } from '#verifica/png.js';

let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

/** A transparent RGBA photo with an opaque elliptic ring (hole inside) and a smaller blob apart. */
const fotoAnello = (): ImmagineRaster => {
  const [larghezza, altezza] = [600, 400];
  const dati = new Uint8Array(larghezza * altezza * 4);
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      const esterno = ((x + 0.5 - 300) / 160) ** 2 + ((y + 0.5 - 200) / 100) ** 2 <= 1;
      const foro = ((x + 0.5 - 300) / 80) ** 2 + ((y + 0.5 - 200) / 40) ** 2 <= 1;
      const macchia = (x + 0.5 - 560) ** 2 + (y + 0.5 - 40) ** 2 <= 15 ** 2;
      const k = (y * larghezza + x) * 4;
      dati.set([200, 30, 30, (esterno && !foro) || macchia ? 255 : 0], k);
    }
  }
  return { larghezza, altezza, canali: 4, dati };
};

const somma = (dati: Uint8Array): number => dati.reduce((totale, valore) => totale + valore, 0);

/** A 1-bit grey PNG (the mode PIL saves binary masks in), written by hand. */
const pngUnBit = (larghezza: number, altezza: number, acceso: (x: number, y: number) => boolean): Uint8Array => {
  const passo = Math.ceil(larghezza / 8);
  const grezzo = new Uint8Array(altezza * (passo + 1));
  for (let y = 0; y < altezza; y++) {
    for (let x = 0; x < larghezza; x++) {
      if (acceso(x, y)) {
        grezzo[y * (passo + 1) + 1 + (x >> 3)]! |= 0x80 >> (x & 7);
      }
    }
  }
  const blocco = (nome: string, corpo: Uint8Array): Buffer => {
    const testa = Buffer.alloc(8);
    testa.writeUInt32BE(corpo.length, 0);
    testa.write(nome, 4, 'latin1');
    const coda = Buffer.alloc(4);
    coda.writeUInt32BE(crc32(Buffer.concat([testa.subarray(4), corpo])), 0);
    return Buffer.concat([testa, corpo, coda]);
  };
  const intestazione = Buffer.alloc(13);
  intestazione.writeUInt32BE(larghezza, 0);
  intestazione.writeUInt32BE(altezza, 4);
  intestazione[8] = 1;
  intestazione[9] = 0;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      blocco('IHDR', intestazione),
      blocco('IDAT', deflateSync(grezzo)),
      blocco('IEND', new Uint8Array(0)),
    ]),
  );
};

describe('PNG senza canvas', () => {
  it('should round-trip RGBA and grey pictures', async () => {
    const rgba = fotoAnello();
    const letto = await decodificaPng(await codificaPng(rgba));
    expect(letto.canali).toBe(4);
    expect(letto.dati).toEqual(rgba.dati);
    const grigio: ImmagineRaster = { larghezza: 3, altezza: 2, canali: 1, dati: Uint8Array.of(0, 128, 255, 7, 8, 9) };
    expect((await decodificaPng(await codificaPng(grigio))).dati).toEqual(grigio.dati);
  });

  it('should read the PNG of render (zlib, filtered rows) and a 1-bit grey mask', async () => {
    const immagine = lib.render(lib.Box(10, 10, 10), { view: 'front', size: [64, 48], background: 'white' });
    const letto = await decodificaPng(immagine.data);
    expect([letto.larghezza, letto.altezza, letto.canali]).toEqual([64, 48, 3]);
    expect(letto.dati).toEqual(immagine.pixels);
    const unBit = await decodificaPng(pngUnBit(13, 5, (x, y) => x === y || x === 12));
    expect(unBit.canali).toBe(1);
    expect([...unBit.dati.subarray(0, 13)]).toEqual([255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255]);
    expect(unBit.dati[4 * 13 + 4]).toBe(255);
  });

  it('should refuse what is not a PNG', async () => {
    await expect(decodificaPng(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9))).rejects.toThrow(/PNG/);
  });
});

describe('maschera di riferimento', () => {
  it('should keep the largest component with its hole and crop it to 256 with a 12 % margin', async () => {
    const maschera = await preparaMascheraPng(await codificaPng(fotoAnello()), { pxPerMm: 4 });
    expect([maschera.larghezza, maschera.altezza]).toEqual([256, 256]);
    // The ring spans 320 × 200 photo px: crop side 320 · 1.24, k = 256 / 396.8.
    expect(maschera.riquadroFoto).toEqual([140, 100, 459, 299]);
    expect(maschera.k).toBeCloseTo(256 / (320 * 1.24), 9);
    expect(maschera.pxPerMm).toBeCloseTo(4 * maschera.k, 9);
    // Centre of the hole is empty; the ring is full; the blob (top right of the photo) is gone.
    expect(maschera.dati[128 * 256 + 128]).toBe(0);
    expect(maschera.dati[128 * 256 + Math.round(128 + 120 * maschera.k)]).toBe(1);
    const areaAttesa = Math.PI * (160 * 100 - 80 * 40) * maschera.k ** 2;
    expect(Math.abs(somma(maschera.dati) - areaAttesa) / areaAttesa).toBeLessThan(0.01);
    expect(maschera.momenti.baricentro[0]).toBeCloseTo(128, 0);
    expect(maschera.momenti.baricentro[1]).toBeCloseTo(128, 0);
    expect(maschera.momenti.angoloAsse).toBeCloseTo(0, 3);
  });

  it('should drop an 8 % band on the occluded sides and the pixels beyond the photo', () => {
    const foto = fotoAnello();
    const aperta = preparaMaschera(foto);
    // The crop (396.8 px tall) is taller than the 400 px photo only by a little: all valid without occlusion.
    expect(somma(aperta.valida)).toBe(256 * 256);
    const occlusa = preparaMaschera(foto, { latiOcclusi: ['alto', 'destra'] });
    const fascia = Math.round(0.08 * 256);
    for (const [x, y, attesa] of [
      [128, fascia - 1, 0],
      [128, fascia, 1],
      [256 - fascia, 128, 0],
      [256 - fascia - 1, 128, 1],
      [0, 255, 1],
    ] as const) {
      expect(occlusa.valida[y * 256 + x]).toBe(attesa);
    }
    // A part cut by the photo border: what lies beyond the border is not valid.
    const tagliata: ImmagineRaster = { larghezza: 200, altezza: 100, canali: 1, dati: new Uint8Array(200 * 100) };
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 80; x++) {
        tagliata.dati[y * 200 + x] = 255;
      }
    }
    const bordo = preparaMaschera(tagliata);
    // 80 × 100 part touching the left, top and bottom borders: the crop (124 px) sticks out on three sides.
    expect(bordo.valida[128 * 256 + 2]).toBe(0);
    expect(bordo.valida[2 * 256 + 128]).toBe(0);
    expect(bordo.valida[128 * 256 + 250]).toBe(1);
    expect(bordo.dati[128 * 256 + 128]).toBe(1);
  });

  it('should find the principal axis of a tilted ellipse', () => {
    const lato = 256;
    const dati = new Uint8Array(lato * lato);
    const angolo = (30 * Math.PI) / 180;
    for (let y = 0; y < lato; y++) {
      for (let x = 0; x < lato; x++) {
        const [dx, dy] = [x + 0.5 - 128, 128 - (y + 0.5)];
        const u = dx * Math.cos(angolo) + dy * Math.sin(angolo);
        const v = -dx * Math.sin(angolo) + dy * Math.cos(angolo);
        dati[y * lato + x] = (u / 90) ** 2 + (v / 30) ** 2 <= 1 ? 1 : 0;
      }
    }
    const m = momenti({ larghezza: lato, altezza: lato, dati });
    expect(m.angoloAsse).toBeCloseTo(30, 0);
    // Uniform ellipse: σ = semiaxis / 2, so 2σ gives back the semiaxes.
    expect(m.semiassi[0]).toBeCloseTo(90, -0.5);
    expect(m.semiassi[1]).toBeCloseTo(30, -0.5);
  });
});
