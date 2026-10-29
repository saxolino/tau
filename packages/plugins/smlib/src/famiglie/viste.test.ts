// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { famiglie } from '#famiglie/registro.js';
import { facceVista } from '#famiglie/viste.js';
import { visteOrtogonali, visteOrtogonaliDi } from '#famiglie/viste-ortogonali.js';
import { assiCamera } from '#verifica/camera.js';
import type { Vettore3 } from '#verifica/camera.js';

const arrotonda = (v: Vettore3): number[] => v.map((x) => Math.round(x * 1000) / 1000 + 0);

/** Per ogni famiglia: la faccia di prodotto e, nel suo telaio, dove sta la camera che la guarda dritta. */
const attese: Record<string, { principale: string; direzione: number[]; su: number[]; destra: number[] }> = {
  // Fianco esterno del tacco (+X): la camera sta su +X e guarda −X, la punta (+Y) è a destra, l'alto è +Z.
  tacco: { principale: 'fianco_esterno', direzione: [-1, 0, 0], su: [0, 0, 1], destra: [0, 1, 0] },
  fondo_semplice: { principale: 'fianco_esterno', direzione: [-1, 0, 0], su: [0, 0, 1], destra: [0, 1, 0] },
  // Pezzi piatti su XY con la faccia a vista +Z: la camera guarda dall'alto (−Z), +Y in alto, +X a destra.
  fibbia: { principale: 'sopra', direzione: [0, 0, -1], su: [0, 1, 0], destra: [1, 0, 0] },
  placca: { principale: 'sopra', direzione: [0, 0, -1], su: [0, 1, 0], destra: [1, 0, 0] },
  pendente: { principale: 'sopra', direzione: [0, 0, -1], su: [0, 1, 0], destra: [1, 0, 0] },
  occhiello: { principale: 'sopra', direzione: [0, 0, -1], su: [0, 1, 0], destra: [1, 0, 0] },
  borchia: { principale: 'sopra', direzione: [0, 0, -1], su: [0, 1, 0], destra: [1, 0, 0] },
  puntale: { principale: 'fianco_esterno', direzione: [-1, 0, 0], su: [0, 0, 1], destra: [0, 1, 0] },
};

describe('viste delle famiglie', () => {
  it('should define the views of every family of the registry', () => {
    for (const famiglia of Object.values(famiglie)) {
      expect(famiglia.viste, famiglia.id).toBeDefined();
      expect(famiglia.viste.facce.length, famiglia.id).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(Object.keys(famiglie))('should keep the faces of %s consistent', (id) => {
    const { viste } = famiglie[id as keyof typeof famiglie]!;
    const ids = viste.facce.map((faccia) => faccia.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const faccia of viste.facce) {
      expect(facceVista, faccia.id).toContain(faccia.id);
      expect(faccia.descrizione.length).toBeGreaterThan(10);
      expect(faccia.camera.rollo).toBe(0);
    }
    expect(ids).toContain(viste.principale);
    // «fronte / tre quarti / lato / alto» puntano a facce che la famiglia ha.
    expect(Object.keys(viste.nomi).toSorted()).toStrictEqual(['alto', 'fronte', 'lato', 'tre_quarti']);
    for (const vista of Object.values(viste.nomi)) {
      expect(ids).toContain(vista.faccia);
    }
  });

  it.each(Object.entries(attese))(
    'should put the camera of the main face of %s where the trade looks at it',
    (id, atteso) => {
      const { viste } = famiglie[id as keyof typeof famiglie]!;
      expect(viste.principale).toBe(atteso.principale);
      const principale = viste.facce.find((faccia) => faccia.id === viste.principale)!;
      const assi = assiCamera(principale.camera);
      expect(arrotonda(assi.direzione)).toStrictEqual(atteso.direzione);
      expect(arrotonda(assi.su)).toStrictEqual(atteso.su);
      expect(arrotonda(assi.destra)).toStrictEqual(atteso.destra);
    },
  );

  it('should show the ring three-quarters on the stone, with the stone in the upper half of the picture', () => {
    const { viste } = famiglie.anello!;
    expect(viste.principale).toBe('tre_quarti_pietra');
    const { camera } = viste.facce.find((faccia) => faccia.id === 'tre_quarti_pietra')!;
    const { direzione, su } = assiCamera(camera);
    // La testa dell'anello è +Z: la camera sta sopra (guarda in giù) e +Z resta in alto nell'immagine.
    expect(direzione[2]).toBeLessThan(-0.4);
    expect(su[2]).toBeGreaterThan(0.5);
  });

  it.each(Object.keys(famiglie))('should generate for %s only views of faces the family has', (id) => {
    const { viste } = famiglie[id as keyof typeof famiglie]!;
    const facce = new Set(viste.facce.map((faccia) => faccia.id));
    const voce = visteOrtogonali[id as keyof typeof visteOrtogonali];
    expect(voce, id).toBeDefined();
    for (const tabella of [voce, ...Object.values(voce.varianti ?? {})]) {
      expect(facce, id).toContain(tabella.principale);
      expect(tabella.controllo.length, id).toBeGreaterThanOrEqual(1);
      for (const controllo of tabella.controllo) {
        expect(facce, id).toContain(controllo);
        expect(controllo, id).not.toBe(tabella.principale);
      }
    }
  });

  it('should look at the sole from below, the wedge from the side, and the heel seat from above only on request', () => {
    expect(visteOrtogonaliDi('fondo_semplice')).toStrictEqual({ principale: 'sotto', controllo: ['fianco_esterno'] });
    expect(visteOrtogonaliDi('fondo_semplice', 'zeppa')).toStrictEqual({
      principale: 'fianco_esterno',
      controllo: ['sotto'],
    });
    expect(visteOrtogonaliDi('fondo_semplice', 'platform')?.principale).toBe('sotto');
    expect(visteOrtogonaliDi('tacco')).toStrictEqual({ principale: 'fianco_esterno', controllo: ['dietro', 'sopra'] });
    expect(visteOrtogonaliDi('fibbia')).toStrictEqual({ principale: 'sopra', controllo: ['fianco_esterno'] });
    expect(visteOrtogonaliDi('anello')?.principale).toBe('asse_dito');
    expect(visteOrtogonaliDi('libero')).toBeUndefined();
    expect(visteOrtogonaliDi('constructor')).toBeUndefined();
    expect(visteOrtogonaliDi('fondo_semplice', 'constructor')?.principale).toBe('sotto');
  });

  it('should map fronte to the face the trade calls the front of each part', () => {
    expect(famiglie.tacco!.viste.nomi.fronte.faccia).toBe('davanti');
    expect(famiglie.fibbia!.viste.nomi.fronte.faccia).toBe('sopra');
    expect(famiglie.anello!.viste.nomi.fronte.faccia).toBe('asse_dito');
    expect(famiglie.puntale!.viste.nomi.alto.faccia).toBe('sopra');
  });
});
