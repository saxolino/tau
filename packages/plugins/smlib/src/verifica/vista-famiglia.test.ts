// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { famiglie } from '#famiglie/registro.js';
import { assiCamera } from '#verifica/camera.js';
import { cameraDaFaccia, cameraDaVista } from '#verifica/vista-famiglia.js';

const vicino = (a: number, b: number, tolleranza = 1e-6): void => {
  expect(Math.abs(a - b)).toBeLessThan(tolleranza);
};

describe('camera dalla faccia dichiarata', () => {
  it('should give back the base camera when the offsets are zero', () => {
    for (const base of [
      { azimuth: 90, elevation: 0, rollo: 0 },
      { azimuth: 0, elevation: 90, rollo: 0 },
      { azimuth: 35, elevation: 35, rollo: 0 },
      { azimuth: 180, elevation: -90, rollo: 0 },
    ]) {
      const camera = cameraDaFaccia(base, { azimuth: 0, elevation: 0, rollo: 0 });
      const atteso = assiCamera(base);
      const trovato = assiCamera(camera);
      for (let i = 0; i < 3; i++) {
        vicino(trovato.direzione[i]!, atteso.direzione[i]!);
        vicino(trovato.su[i]!, atteso.su[i]!);
      }
    }
  });

  it('should move the camera right and up in the picture by the offsets', () => {
    // Fianco esterno del tacco: camera su +X, punta (+Y) a destra. +30 di azimuth = camera verso la punta.
    const verso = cameraDaFaccia({ azimuth: 90, elevation: 0, rollo: 0 }, { azimuth: 30, elevation: 0, rollo: 0 });
    const assi = assiCamera(verso);
    // La camera va dalla parte della punta (+Y) e guarda indietro, verso −Y.
    expect(assi.direzione[1]).toBeLessThan(-0.4);
    vicino(verso.elevation, 0);
    // +20 di elevation: la camera sale, l'alto dell'immagine resta +Z.
    const su = cameraDaFaccia({ azimuth: 90, elevation: 0, rollo: 0 }, { azimuth: 0, elevation: 20, rollo: 0 });
    vicino(su.elevation, 20);
    vicino(su.azimuth, 90);
    vicino(su.rollo, 0);
  });

  it('should add the picture-plane roll', () => {
    expect(
      cameraDaFaccia({ azimuth: 0, elevation: 90, rollo: 0 }, { azimuth: 0, elevation: 0, rollo: 12 }).rollo,
    ).toBeCloseTo(12, 6);
  });
});

describe('camera di partenza dalla vista del riconoscimento', () => {
  it('should start a buckle called «fronte» from above: elevation ~82, not edge-on', () => {
    const camera = cameraDaVista(famiglie.fibbia!.viste, {
      faccia: 'sopra',
      nome: 'fronte',
      azimuth: 4,
      elevation: 8,
      rollo: -2,
    });
    expect(camera.origine).toBe('faccia');
    expect(camera.elevation).toBeGreaterThan(80);
    expect(camera.elevation).toBeLessThan(84);
    const { direzione } = assiCamera(camera);
    expect(direzione[2]).toBeLessThan(-0.98);
  });

  it('should start a heel seen from the outer side at azimuth 90, and from the front at 180', () => {
    const lato = cameraDaVista(famiglie.tacco!.viste, { faccia: 'fianco_esterno', azimuth: 0, elevation: 0, rollo: 0 });
    vicino(lato.azimuth, 90);
    vicino(lato.elevation, 0);
    const davanti = cameraDaVista(famiglie.tacco!.viste, { faccia: 'davanti', azimuth: 0, elevation: 5, rollo: 0 });
    vicino(Math.abs(davanti.azimuth), 180);
    vicino(davanti.elevation, 5);
  });

  it('should resolve the view name when the face is missing or is not a face of the family', () => {
    const senza = cameraDaVista(famiglie.fibbia!.viste, { nome: 'fronte', azimuth: 4, elevation: 8, rollo: 0 });
    expect(senza.origine).toBe('nome');
    expect(senza.elevation).toBe(90);
    // «davanti» non è una faccia dell'anello: si ripiega sul nome della vista.
    const altra = cameraDaVista(famiglie.anello!.viste, {
      faccia: 'davanti',
      nome: 'tre_quarti',
      azimuth: 0,
      elevation: 0,
      rollo: 0,
    });
    expect(altra.origine).toBe('nome');
    vicino(altra.elevation, 35);
  });

  it('should read the angles as they are when the family has no view data or the view says nothing', () => {
    expect(cameraDaVista(undefined, { faccia: 'sopra', azimuth: 4, elevation: 8, rollo: 1 })).toStrictEqual({
      azimuth: 4,
      elevation: 8,
      rollo: 1,
      origine: 'assoluta',
    });
    expect(
      cameraDaVista(famiglie.fibbia!.viste, { nome: 'dietro', azimuth: 170, elevation: 3, rollo: 0 }).origine,
    ).toBe('nome');
    expect(cameraDaVista(famiglie.tacco!.viste, { nome: 'sotto', azimuth: 0, elevation: -90, rollo: 0 }).origine).toBe(
      'nome',
    );
    expect(cameraDaVista(famiglie.tacco!.viste, { azimuth: 12, elevation: 3, rollo: 0 }).origine).toBe('assoluta');
  });
});
