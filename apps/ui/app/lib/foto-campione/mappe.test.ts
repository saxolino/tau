// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { scatole } from '#lib/foto-campione/cubo.fixture.js';
import { definizioniViste, iouSagome, rendiMappe } from '#lib/foto-campione/mappe-condivise.js';
import type { MappeFoto } from '#lib/foto-campione/mappe-condivise.js';

const cubo = scatole({ min: [-10, -10, -10], max: [10, 10, 10] });
const lato = 256;

const coperti = (mappe: MappeFoto): number => mappe.sagoma.dati.reduce((somma, valore) => somma + valore, 0);

describe('sample photo maps', () => {
  it('should give four square pictures of the asked side, with the channels the function checks', () => {
    for (const vista of ['fronte', 'tre-quarti', 'dettaglio'] as const) {
      const mappe = rendiMappe(cubo, vista, lato);
      expect([mappe.ombreggiata.larghezza, mappe.ombreggiata.altezza, mappe.ombreggiata.canali]).toStrictEqual([
        lato,
        lato,
        1,
      ]);
      expect([mappe.profondita.larghezza, mappe.profondita.canali]).toStrictEqual([lato, 1]);
      expect([mappe.normali.larghezza, mappe.normali.canali, mappe.normali.dati.length]).toStrictEqual([
        lato,
        3,
        lato * lato * 3,
      ]);
      expect([mappe.bordi.larghezza, mappe.bordi.canali]).toStrictEqual([lato, 1]);
      expect([mappe.sagoma.larghezza, mappe.sagoma.altezza, mappe.sagoma.dati.length]).toStrictEqual([
        lato,
        lato,
        lato * lato,
      ]);
    }
  });

  it('should frame the model in the margin and paint the background in each map’s neutral value', () => {
    const mappe = rendiMappe(cubo, 'fronte', lato);
    // Front at elevation 6°: 20 mm wide, 20·cos 6° + 20·sin 6° ≈ 21.98 mm tall → the taller side fills 76 % of the frame.
    const alto = 20 * Math.cos((6 * Math.PI) / 180) + 20 * Math.sin((6 * Math.PI) / 180);
    expect(mappe.pxPerMm).toBeCloseTo((lato * (1 - 2 * definizioniViste.fronte.margine)) / alto, 6);
    expect(coperti(mappe) / (20 * alto * mappe.pxPerMm ** 2)).toBeCloseTo(1, 1);
    expect(mappe.ombreggiata.dati[0]).toBe(255);
    expect(mappe.profondita.dati[0]).toBe(0);
    expect([...mappe.normali.dati.subarray(0, 3)]).toStrictEqual([128, 128, 255]);
    expect(mappe.bordi.dati[0]).toBe(255);
    // The model itself is grey, never the background's white.
    const centro = (lato / 2) * lato + lato / 2;
    expect(mappe.ombreggiata.dati[centro]).toBeLessThan(240);
    expect(mappe.ombreggiata.dati[centro]).toBeGreaterThan(20);
  });

  it('should make depth monotonic across the cube’s top face: farther up the picture is darker', () => {
    const mappe = rendiMappe(cubo, 'tre-quarti', lato);
    const colonna = lato / 2;
    // The top face's camera normal is (0, cos 22°, sin 22°): green ≈ 246, the side faces stay under 200.
    const righe: Array<{ y: number; profondita: number }> = [];
    for (let y = 0; y < lato; y++) {
      const p = y * lato + colonna;
      if (mappe.sagoma.dati[p] === 1 && mappe.normali.dati[p * 3 + 1]! > 200) {
        righe.push({ y, profondita: mappe.profondita.dati[p]! });
      }
    }
    expect(righe.length).toBeGreaterThan(10);
    for (let i = 1; i < righe.length; i++) {
      expect(righe[i]!.profondita).toBeGreaterThanOrEqual(righe[i - 1]!.profondita);
    }
    expect(righe.at(-1)!.profondita - righe[0]!.profondita).toBeGreaterThan(20);
  });

  it('should paint the nearer of two boxes lighter in the depth map', () => {
    // Front camera on −Y: the box at y = −30 is nearer than the one at y = +30.
    // Tall enough not to count as a flat piece (which «fronte» would see from above).
    const due = scatole({ min: [-25, -35, -30], max: [-15, -25, 30] }, { min: [15, 25, -30], max: [25, 35, 30] });
    const mappe = rendiMappe(due, 'fronte', lato);
    const media = (sinistra: boolean): number => {
      let [somma, conta] = [0, 0];
      for (let y = 0; y < lato; y++) {
        for (let x = sinistra ? 0 : lato / 2; x < (sinistra ? lato / 2 : lato); x++) {
          const p = y * lato + x;
          if (mappe.sagoma.dati[p] === 1) {
            somma += mappe.profondita.dati[p]!;
            conta++;
          }
        }
      }
      return somma / conta;
    };
    expect(media(true)).toBeGreaterThan(media(false) + 50);
  });

  it('should hide a box behind another: same silhouette and same depth as the front box alone', () => {
    const davanti = scatole({ min: [-10, -10, -10], max: [10, 10, 10] });
    const conDietro = scatole({ min: [-10, -10, -10], max: [10, 10, 10] }, { min: [-4, 20, -4], max: [4, 28, 4] });
    const sola = rendiMappe(davanti, 'fronte', lato);
    const coperta = rendiMappe(conDietro, 'fronte', lato);
    expect(iouSagome(sola.sagoma, coperta.sagoma)).toBe(1);
    expect([...coperta.normali.dati]).toStrictEqual([...sola.normali.dati]);
    expect([...coperta.profondita.dati]).toStrictEqual([...sola.profondita.dati]);
  });

  it('should draw the outline and the visible edges, and give the same bytes for the same model', () => {
    const mappe = rendiMappe(cubo, 'tre-quarti', lato);
    let scuri = 0;
    for (const valore of mappe.bordi.dati) {
      scuri += valore === 0 ? 1 : 0;
    }
    expect(scuri).toBeGreaterThan(300);
    expect(scuri).toBeLessThan(coperti(mappe) / 3);
    const ancora = rendiMappe(cubo, 'tre-quarti', lato);
    expect([...ancora.ombreggiata.dati]).toStrictEqual([...mappe.ombreggiata.dati]);
    expect([...ancora.profondita.dati]).toStrictEqual([...mappe.profondita.dati]);
  });

  it('should bring «dettaglio» closer than the three-quarter view, from the same camera', () => {
    const tre = rendiMappe(cubo, 'tre-quarti', lato);
    const dettaglio = rendiMappe(cubo, 'dettaglio', lato);
    expect(dettaglio.pxPerMm / tre.pxPerMm).toBeCloseTo(1.9, 6);
    expect(coperti(dettaglio)).toBeGreaterThan(coperti(tre));
  });

  it('should refuse a model without a surface', () => {
    expect(() =>
      rendiMappe(
        { triangoli: new Float32Array(), normali: new Float32Array(), segmenti: new Float32Array() },
        'fronte',
        lato,
      ),
    ).toThrow(/no surface/u);
  });

  it('should photograph a flat piece’s «fronte» from above, a standing one from the front', () => {
    const placca = scatole({ min: [-20, -10, 0], max: [20, 10, 3] });
    const piatta = rendiMappe(placca, 'fronte', lato);
    expect(piatta.camera).toStrictEqual({ azimuth: 0, elevation: 90 });
    // From above: 40 × 20 mm, the long side filling 76 % of the frame.
    expect(coperti(piatta) / (40 * 20 * piatta.pxPerMm ** 2)).toBeCloseTo(1, 1);
    expect(rendiMappe(cubo, 'fronte', lato).camera).toStrictEqual({ azimuth: 0, elevation: 6 });
    expect(rendiMappe(placca, 'tre-quarti', lato).camera).toStrictEqual({ azimuth: 35, elevation: 22 });
  });
});
