// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { tacco } from '#famiglie/tacco.js';
import {
  assePerno,
  cavitaTacco,
  contornoSezione,
  dentroSezione,
  mezzaLarghezzaA,
  profiloTacco,
  profonditaForo,
  puntoDaSeduta,
  quotaSeduta,
  sedutaDaPunto,
  sezioneDiCavita,
} from '#famiglie/tacco-profilo.js';
import type { ParametriTacco, VarianteTacco } from '#famiglie/tacco-profilo.js';

const parametri = (grezzi: unknown, variante: VarianteTacco): ParametriTacco => tacco.normalizza(grezzi, { variante });

/** Il record del progetto «Tacco a spillo» visto il 29 ottobre: 95 mm, tappo 13 × 10, il resto non letto. */
const spillo = (): ParametriTacco =>
  parametri({ tacco: { altezza: 95 }, tappo: { lunghezza: 13, larghezza: 10 } }, 'stiletto');

describe('profilo del tacco (legge di forma, senza kernel)', () => {
  it('should put the seat on B at the heel height and F lower by the seat slope', () => {
    const p = parametri({}, 'stiletto');
    const { seduta } = profiloTacco(p, 'stiletto');
    const alfa = (p.seduta.inclinazione * Math.PI) / 180;
    expect(seduta.dorso[1]).toBe(p.tacco.altezza);
    expect(seduta.petto[1]).toBeCloseTo(p.tacco.altezza - p.seduta.lunghezza * Math.sin(alfa), 9);
    expect(seduta.petto[0] - seduta.dorso[0]).toBeCloseTo(p.seduta.lunghezza * Math.cos(alfa), 9);
    // The seat is dished: zero at B and F, deepest in the middle.
    expect(quotaSeduta(seduta, p.seduta.larghezza, [0, seduta.dorso[0]])).toBeCloseTo(p.tacco.altezza, 9);
    expect(quotaSeduta(seduta, p.seduta.larghezza, [0, seduta.petto[0]])).toBeCloseTo(seduta.petto[1], 9);
    const centro = (seduta.dorso[0] + seduta.petto[0]) / 2;
    const piano = (seduta.dorso[1] + seduta.petto[1]) / 2;
    expect(piano - quotaSeduta(seduta, p.seduta.larghezza, [0, centro])).toBeCloseTo(
      seduta.incavoLungo + seduta.incavoLargo,
      9,
    );
    // The rim at the sides is higher than the centre line (the seat is cupped across).
    expect(quotaSeduta(seduta, p.seduta.larghezza, [p.seduta.larghezza / 2, centro])).toBeGreaterThan(
      quotaSeduta(seduta, p.seduta.larghezza, [0, centro]) + 2,
    );
  });

  it('should draw the back and the breast as separate lines, not one funnel scaled about an axis', () => {
    const p = parametri({}, 'stiletto');
    const profilo = profiloTacco(p, 'stiletto');
    const vita = profilo.vita!;
    const tappo = profilo.sezioneA(p.tappo.altezza);
    const fusto = profilo.sezioneA(vita);
    const meta = profilo.sezioneA((p.tappo.altezza + vita) / 2);
    // The shank is straight between the top lift and the waist, and thin (stiletto ≈ 0.3 of the seat).
    expect(meta.petto - meta.dorso).toBeCloseTo((tappo.petto - tappo.dorso + fusto.petto - fusto.dorso) / 2, 6);
    expect(fusto.larghezza).toBeLessThan(0.35 * p.seduta.larghezza);
    // Above the waist the breast opens much more than the back (the arch under the front of the seat).
    const fronte = profilo.seduta.petto;
    const { dorso } = profilo.seduta;
    expect(fronte[0] - fusto.petto).toBeGreaterThan(1.15 * (fusto.dorso - dorso[0]));
    // The breast reaches F, the back reaches B and turns vertical there (no stock behind B).
    expect(profilo.sezioneA(fronte[1]).petto).toBeCloseTo(fronte[0], 6);
    expect(profilo.sezioneA(dorso[1]).dorso).toBeCloseTo(dorso[0], 6);
    expect(profilo.sezioneA(dorso[1] + 2).dorso).toBeCloseTo(dorso[0], 6);
    expect(profilo.sezioneA(dorso[1] - 0.5).dorso - dorso[0]).toBeLessThan(0.15);
    // From behind the width reaches the seat at F and stays there.
    expect(profilo.sezioneA(fronte[1]).larghezza).toBeCloseTo(p.seduta.larghezza, 6);
    expect(profilo.sezioneA(dorso[1]).larghezza).toBeCloseTo(p.seduta.larghezza, 6);
  });

  it('should follow the breast and back bulges: negative breast = deeper arch, positive back = fuller back', () => {
    const base = profiloTacco(parametri({}, 'stiletto'), 'stiletto');
    const arco = profiloTacco(parametri({ fronte: { bombatura: -6 } }, 'stiletto'), 'stiletto');
    const pieno = profiloTacco(parametri({ dorso: { bombatura: 6 } }, 'stiletto'), 'stiletto');
    const z = (base.vita! + base.seduta.petto[1]) / 2 + 3;
    expect(arco.sezioneA(z).petto).toBeLessThan(base.sezioneA(z).petto - 2);
    const zDorso = (base.vita! + base.seduta.dorso[1]) / 2;
    expect(pieno.sezioneA(zDorso).dorso).toBeLessThan(base.sezioneA(zDorso).dorso - 2);
  });

  it('should narrow a spool at its waist and open again toward a wide top lift', () => {
    const p = parametri({}, 'rocchetto');
    const profilo = profiloTacco(p, 'rocchetto');
    const vita = profilo.sezioneA(profilo.vita!);
    expect(vita.larghezza).toBeLessThan(0.75 * p.tappo.larghezza);
    expect(profilo.sezioneA(p.tappo.altezza).larghezza).toBeCloseTo(p.tappo.larghezza, 6);
  });

  it('should keep block and cone sides straight from the top lift to the seat', () => {
    for (const variante of ['blocco', 'cono'] as const) {
      const p = parametri({}, variante);
      const profilo = profiloTacco(p, variante);
      const [, zF] = profilo.seduta.petto;
      const z0 = p.tappo.altezza;
      const meta = profilo.sezioneA((z0 + zF) / 2);
      expect(meta.larghezza).toBeCloseTo((p.tappo.larghezza + p.seduta.larghezza) / 2, 6);
      expect(meta.petto).toBeCloseTo((profilo.sezioneA(z0).petto + profilo.seduta.petto[0]) / 2, 6);
    }
  });

  it('should sample every section from the back point, in the same order, so the loft cannot twist', () => {
    const p = parametri({ seduta: { forma: 'scudo' }, tappo: { forma: 'ellisse' } }, 'stiletto');
    const profilo = profiloTacco(p, 'stiletto');
    for (const sezione of profilo.sezioni) {
      const punti = contornoSezione(sezione, 16);
      expect(punti).toHaveLength(16);
      expect(punti[0]![0]).toBeCloseTo(0, 9);
      expect(punti[0]![1]).toBeCloseTo(sezione.dorso, 9);
      expect(punti[8]![1]).toBeCloseTo(sezione.petto, 9);
      for (let k = 1; k < 8; k++) {
        // Mirror pairs across x = 0, +X side first.
        expect(punti[k]![0]).toBeGreaterThan(0);
        expect(punti[16 - k]![0]).toBeCloseTo(-punti[k]![0], 6);
        expect(punti[16 - k]![1]).toBeCloseTo(punti[k]![1], 6);
      }
    }
  });

  it('should round the back of the seat like the heel of the shoe and square the breast for the shield', () => {
    const p = parametri({ seduta: { forma: 'scudo' } }, 'blocco');
    const sezione = profiloTacco(p, 'blocco').sezioneA(p.tacco.altezza);
    const lunghezza = sezione.petto - sezione.dorso;
    // 10 % from each end: the back is round (narrow), the breast square (wide).
    const dietro = mezzaLarghezzaA(sezione, sezione.dorso + 0.1 * lunghezza);
    const davanti = mezzaLarghezzaA(sezione, sezione.petto - 0.1 * lunghezza);
    expect(davanti).toBeGreaterThan(dietro * 1.25);
  });

  it('should space the loft stations gradually: no gap more than twice its neighbour', () => {
    for (const variante of ['stiletto', 'blocco', 'rocchetto', 'cono', 'kitten'] as const) {
      for (const altezza of [40, 85, 120]) {
        const p = parametri({ tacco: { altezza }, seduta: { inclinazione: 30 } }, variante);
        const quote = profiloTacco(p, variante).sezioni.map(({ z }) => z);
        const passi = quote.slice(1).map((z, i) => z - quote[i]!);
        for (const [i, passo] of passi.entries()) {
          expect(passo).toBeGreaterThan(0);
          if (i > 0) {
            expect(passo / passi[i - 1]!, `${variante} ${altezza} passo ${i}`).toBeLessThan(2.05);
            expect(passi[i - 1]! / passo, `${variante} ${altezza} passo ${i}`).toBeLessThan(2.05);
          }
        }
      }
    }
  });

  it('should stop the steel shank 6 mm under the seat, on the axis tilted by the pitch', () => {
    const p = parametri({}, 'stiletto');
    const perno = assePerno(p);
    const cima: [number, number] = [
      perno.base[0] + perno.direzione[0] * perno.lunghezza,
      perno.base[1] + perno.direzione[1] * perno.lunghezza,
    ];
    const { seduta } = profiloTacco(p, 'stiletto');
    expect(quotaSeduta(seduta, p.seduta.larghezza, [0, cima[0]]) - cima[1]).toBeCloseTo(6, 1);
    expect(perno.base[1]).toBeCloseTo(p.tappo.altezza - 2, 9);
    expect(Math.atan2(perno.direzione[0], perno.direzione[1])).toBeCloseTo((p.tacco.spinta * Math.PI) / 180, 9);
  });

  it('should move between the seat frame and the side plane and back', () => {
    const { seduta } = profiloTacco(parametri({ seduta: { inclinazione: 25 } }, 'stiletto'), 'stiletto');
    const punto = puntoDaSeduta(seduta, 12, 7);
    const [s, h] = sedutaDaPunto(seduta, punto);
    expect(s).toBeCloseTo(12, 9);
    expect(h).toBeCloseTo(7, 9);
    expect(puntoDaSeduta(seduta, 0, 0)).toStrictEqual([seduta.dorso[0], seduta.dorso[1]]);
  });

  it('should nest every section of the cavity inside the one above, so it comes out along the seat normal', () => {
    for (const [p, variante] of [
      [parametri({}, 'blocco'), 'blocco'],
      [parametri({}, 'stiletto'), 'stiletto'],
      [spillo(), 'stiletto'],
    ] as const) {
      const profilo = profiloTacco(p, variante);
      const cavita = cavitaTacco(p, profilo, { quotaMinima: p.tappo.altezza + 0.3 * p.tacco.altezza })!;
      expect(cavita.sezioni.length).toBeGreaterThan(4);
      const tanSformo = Math.tan(((p.costruzione.sformo + 1) * Math.PI) / 180);
      for (const [i, sotto] of cavita.sezioni.entries()) {
        const sopra = cavita.sezioni[i - 1];
        if (!sopra) {
          continue;
        }
        const scarto = (sotto.h - sopra.h) * tanSformo - 1e-9;
        expect(sotto.dorso - sopra.dorso).toBeGreaterThanOrEqual(scarto);
        expect(sopra.petto - sotto.petto).toBeGreaterThanOrEqual(scarto);
        expect(sopra.mezza - sotto.mezza).toBeGreaterThanOrEqual(scarto);
      }
    }
  });

  it('should keep the cavity a wall away from the outside (checked on the law, every section)', () => {
    const p = spillo();
    const profilo = profiloTacco(p, 'stiletto');
    const cavita = cavitaTacco(p, profilo, { quotaMinima: p.tappo.altezza + 0.3 * p.tacco.altezza })!;
    const { parete } = p.costruzione;
    for (const sezione of cavita.sezioni) {
      for (const [x, s] of contornoSezione(sezioneDiCavita(cavita, sezione), 24)) {
        const [y, z] = puntoDaSeduta(profilo.seduta, s, sezione.h);
        if (z > p.tacco.altezza - 0.5) {
          continue;
        }
        // A sphere of radius «wall» around the point stays inside the body (sampled on 26 directions).
        for (const [dx, dy, dz] of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
          [Math.SQRT1_2, Math.SQRT1_2, 0],
          [-Math.SQRT1_2, Math.SQRT1_2, 0],
          [Math.SQRT1_2, -Math.SQRT1_2, 0],
          [-Math.SQRT1_2, -Math.SQRT1_2, 0],
          [Math.SQRT1_2, 0, Math.SQRT1_2],
          [-Math.SQRT1_2, 0, -Math.SQRT1_2],
          [0, Math.SQRT1_2, Math.SQRT1_2],
          [0, -Math.SQRT1_2, -Math.SQRT1_2],
        ] as const) {
          const zz = z + dz * parete;
          if (zz > p.tacco.altezza) {
            continue;
          }
          expect(dentroSezione(profilo.sezioneA(zz), [x + dx * parete, y + dy * parete]), `${x} ${y} ${zz}`).toBe(true);
        }
      }
    }
  });

  it('should stop a fixing hole before it comes out of the side under a shallow cavity', () => {
    const p = parametri({}, 'kitten');
    const profilo = profiloTacco(p, 'kitten');
    const centro = p.seduta.lunghezza / 2;
    const alCentro = profonditaForo(profilo, { x: 0, s: centro, raggio: 1.6, parete: 1.5, massima: 20 });
    const aLato = profonditaForo(profilo, { x: 9, s: centro - 6, raggio: 1.6, parete: 1.5, massima: 20 });
    expect(alCentro).toBeGreaterThan(14);
    expect(aLato).toBeLessThan(alCentro);
  });

  it('should bring the waist under the front of the seat and the seat slope within the body', () => {
    const p = parametri(
      { tacco: { altezza: 60 }, seduta: { inclinazione: 35, lunghezza: 70 }, vita: { quota: 0.8 } },
      'stiletto',
    );
    const profilo = profiloTacco(p, 'stiletto');
    expect(profilo.vita!).toBeLessThan(profilo.seduta.petto[1] - 5.9);
    expect(profilo.seduta.petto[1]).toBeGreaterThan(p.tappo.altezza + 0.39 * (p.tacco.altezza - p.tappo.altezza));
    expect(tacco.vincoli(p)).toStrictEqual([]);
  });
});
