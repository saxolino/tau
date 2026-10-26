// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { DefinizioneParametro } from '#famiglie/famiglia.js';
import {
  confronta,
  immagineDifferenza,
  iouValida,
  obiettivo,
  preparaConfronto,
  prior,
  sigmaParametro,
  trasformataDistanza,
} from '#verifica/metrica.js';
import type { MascheraBinaria } from '#verifica/silhouette.js';

const lato = 160;

const rettangolo = (x0: number, y0: number, x1: number, y1: number): MascheraBinaria => {
  const dati = new Uint8Array(lato * lato);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      dati[y * lato + x] = 1;
    }
  }
  return { larghezza: lato, altezza: lato, dati };
};

const tutta = new Uint8Array(lato * lato).fill(1);

describe('IoU sulla regione valida', () => {
  it('should give the exact IoU of two known rectangles', () => {
    // 100 × 50 and the same moved 50 px right: intersection 2500, union 7500.
    const a = rettangolo(0, 0, 99, 49);
    const b = rettangolo(50, 0, 149, 49);
    expect(iouValida(a, { dati: b.dati, valida: tutta })).toBeCloseTo(1 / 3, 12);
    // Only the left half of the picture counts: intersection 30 × 50, union 80 × 50.
    const sinistra = Uint8Array.from({ length: lato * lato }, (_, p) => (p % lato < 80 ? 1 : 0));
    expect(iouValida(a, { dati: b.dati, valida: sinistra })).toBeCloseTo(30 / 80, 12);
    expect(iouValida(a, { dati: a.dati, valida: tutta })).toBe(1);
  });
});

describe('chamfer dei contorni', () => {
  it('should compute the exact Euclidean distance transform', () => {
    const accesi = new Uint8Array(lato * lato);
    const punti = [
      [10, 10],
      [150, 20],
      [80, 140],
      [33, 97],
    ] as const;
    for (const [x, y] of punti) {
      accesi[y * lato + x] = 1;
    }
    const distanza = trasformataDistanza(accesi, lato, lato);
    for (let y = 0; y < lato; y += 7) {
      for (let x = 0; x < lato; x += 5) {
        const attesa = Math.min(...punti.map(([px, py]) => Math.hypot(px - x, py - y)));
        expect(distanza[y * lato + x]).toBeCloseTo(attesa, 4);
      }
    }
  });

  it('should be zero on identical shapes and about the inset on nested squares', () => {
    const quadrato = rettangolo(30, 30, 129, 129);
    const riferimento = preparaConfronto({ ...quadrato, valida: tutta });
    expect(confronta(quadrato, riferimento, 4)).toEqual({ iou: 1, chamferPx: 0, chamferMm: 0 });
    // A square inset by 3 px on every side: 3 px each way along the sides, a little more at the outer corners.
    const interno = rettangolo(33, 33, 126, 126);
    const { chamferPx, chamferMm, iou } = confronta(interno, riferimento, 4);
    expect(chamferPx).toBeGreaterThan(6);
    expect(chamferPx).toBeLessThan(6.3);
    expect(chamferMm).toBeCloseTo(chamferPx / 4, 12);
    expect(iou).toBeCloseTo(94 ** 2 / 100 ** 2, 12);
    // An empty silhouette is far, not a division by zero.
    expect(confronta(rettangolo(0, 0, -1, -1), riferimento, 4).chamferPx).toBe(lato);
  });
});

describe('obiettivo', () => {
  const definizioni: DefinizioneParametro[] = [
    { chiave: 'tacco.altezza', unita: 'mm', min: 15, max: 130, default: 85, fonteDefault: 'mestiere' },
    { chiave: 'vita.scala', unita: 'frazione', min: 0.25, max: 1.2, default: 0.45, fonteDefault: 'mestiere' },
    { chiave: 'tappo.lunghezza', unita: 'mm', min: 6, max: 7, default: 6.5, fonteDefault: 'mestiere' },
  ];

  it('should weigh each departure from the estimate by confidence over half the range', () => {
    expect(sigmaParametro(definizioni[0]!)).toBe(57.5);
    expect(sigmaParametro(definizioni[1]!)).toBeCloseTo(0.475, 12);
    // Half of a 1 mm range is below the 1 mm floor.
    expect(sigmaParametro(definizioni[2]!)).toBe(1);
    const stima = {
      parametri: { tacco: { altezza: 85 }, vita: { scala: 0.45 }, tappo: { lunghezza: 6.5 } },
      confidenze: { 'tacco.altezza': 0.8 },
    };
    expect(prior(stima.parametri, stima, definizioni)).toBe(0);
    const spostati = { tacco: { altezza: 85 + 57.5 }, vita: { scala: 0.45 + 0.475 }, tappo: { lunghezza: 7.5 } };
    // 0.8·1² + 0.5·1² (default weight) + 0.5·1².
    expect(prior(spostati, stima, definizioni)).toBeCloseTo(1.8, 12);
    expect(prior(spostati, { ...stima, nonVisibili: ['vita.scala', 'tappo.lunghezza'] }, definizioni)).toBeCloseTo(
      0.8,
      12,
    );
  });

  it('should add IoU, chamfer, prior and constraint terms with the weights of the specification', () => {
    expect(obiettivo({ iou: 1, chamferMm: 0 })).toBe(0);
    expect(obiettivo({ iou: 0.9, chamferMm: 2, prior: 1.5, violazioni: 1 })).toBeCloseTo(
      0.1 + 0.05 * 2 + 0.02 * 1.5 + 0.2,
      12,
    );
  });

  it('should paint the difference picture red where the model is extra and blue where the mask is', () => {
    const s = rettangolo(0, 0, 9, 9);
    const m = rettangolo(5, 0, 14, 9);
    const valida = Uint8Array.from({ length: lato * lato }, (_, p) => (p % lato < 12 ? 1 : 0));
    const immagine = immagineDifferenza(s, { larghezza: lato, altezza: lato, dati: m.dati, valida });
    const colore = (x: number) => [...immagine.dati.subarray(x * 3, x * 3 + 3)];
    expect(colore(0)).toEqual([220, 30, 30]);
    expect(colore(6)).toEqual([70, 70, 70]);
    expect(colore(11)).toEqual([30, 80, 230]);
    // Outside the valid region the colours fade.
    expect(colore(13)[0]).toBeGreaterThan(30);
    expect(colore(20)).toEqual([255, 255, 255]);
  });
});
