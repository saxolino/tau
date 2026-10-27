// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { famiglie } from '#famiglie/registro.js';
import { verificaSilhouette } from '#verifica/ottimizza.js';
import { cameraDaVista } from '#verifica/vista-famiglia.js';
import { casoSintetico, fotoSintetica, ingressoSintetico } from '#verifica/sintetico.js';

/**
 * La vista dichiarata che non spiega la maschera (27 ott 2026, prova `?prova=fibbia` di `/cad/nuovo`): la fibbia giace
 * su XY con la faccia a vista +Z, la foto ne mostra la faccia, il riconoscimento la chiama «fronte» (azimuth 4,
 * elevation 8). Partendo di taglio sul pezzo la fase A non arrivava alla vista dall'alto: IoU 0,05. Con gli avvii
 * lungo gli assi la verifica ritrova la vista e l'accordo.
 */
vi.setConfig({ testTimeout: 180_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

/** Una fibbia fotografata di faccia, leggermente dall'alto, girata di un quarto di giro (il cinturino orizzontale). */
const fibbiaDiFaccia = () => {
  const caso = {
    ...casoSintetico(famiglie.fibbia!, 'rettangolare', 4),
    vista: { azimuth: 2, elevation: 84, rollo: 92 },
    // Quello che il riconoscimento dice della stessa foto: «fronte».
    vistaStimata: { azimuth: 4, elevation: 8, rollo: -2 },
  };
  return { caso, foto: fotoSintetica(lib, caso) };
};

describe('vista dichiarata che non spiega la maschera', () => {
  it('should find the face view of a buckle declared «fronte» and match its mask (IoU ≥ 0.9)', () => {
    const { caso, foto } = fibbiaDiFaccia();
    const esito = verificaSilhouette(
      lib,
      ingressoSintetico(caso, foto, { budgetMs: 120_000, confidenzaVista: 0.78, sensibilita: false }),
    );
    expect(esito.iou).toBeGreaterThanOrEqual(0.9);
    // La camera finale guarda la faccia (+Z), non il fianco.
    expect(Math.abs(esito.camera.elevation)).toBeGreaterThan(60);
    // Il primo avvio è quello della vista dichiarata e non spiegava la maschera.
    expect(esito.avvii[0]!.iou).toBeLessThan(0.5);
    expect(esito.avvii.length).toBeGreaterThan(1);
  });

  it('should keep the declared view alone when it explains the mask', () => {
    const caso = casoSintetico(famiglie.fibbia!, 'rettangolare', 4);
    const esito = verificaSilhouette(
      lib,
      ingressoSintetico(caso, fotoSintetica(lib, caso), { budgetMs: 120_000, sensibilita: false }),
    );
    expect(esito.iou).toBeGreaterThanOrEqual(0.9);
    expect(esito.avvii).toHaveLength(1);
  });

  it('should start a buckle declared «fronte» already from above, with a high first IoU and no axis search', () => {
    // La stessa foto della fibbia di faccia, ma la vista del riconoscimento passa dalla faccia dichiarata: «sopra»
    // (la faccia a vista +Z della fibbia) con gli scarti 4° e 8° dalla vista dritta.
    const caso = {
      ...casoSintetico(famiglie.fibbia!, 'rettangolare', 4),
      vista: { azimuth: 3, elevation: 82, rollo: 1 },
    };
    const partenza = cameraDaVista(famiglie.fibbia!.viste, {
      faccia: 'sopra',
      nome: 'fronte',
      azimuth: 4,
      elevation: 8,
      rollo: -2,
    });
    expect(partenza.origine).toBe('faccia');
    const esito = verificaSilhouette(
      lib,
      ingressoSintetico({ ...caso, vistaStimata: partenza }, fotoSintetica(lib, caso), {
        budgetMs: 120_000,
        confidenzaVista: 0.78,
        sensibilita: false,
      }),
    );
    // Il primo avvio spiega già la maschera (con la vista di prima era 0,05): nessuna delle 24 viste lungo gli assi
    // serve. L'IoU del primo avvio è limitato solo dalle misure della stima, perturbate del 15 %.
    expect(esito.avvii).toHaveLength(1);
    expect(esito.avvii[0]!.iou).toBeGreaterThanOrEqual(0.6);
    expect(esito.iou).toBeGreaterThanOrEqual(0.9);
    expect(esito.camera.elevation).toBeGreaterThan(60);
  });
});
