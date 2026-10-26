/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { fibbia, presetPilotaFibbia } from '#famiglie/fibbia.js';
import type { ParametriFibbia } from '#famiglie/fibbia.js';
import { valoriDerivati } from '#famiglie/parametri.js';
import { rileggiStep } from '#famiglie/verifiche-comuni.js';
import { valutaFamiglia } from '#famiglie/valuta-famiglia.js';

let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const pezzo = (valutazione: ReturnType<typeof valutaFamiglia>, nome: string): Smlib.Part => {
  const trovato = valutazione.pezzi.find(({ name }) => name === nome);
  if (!(trovato?.shape instanceof lib.Part)) {
    throw new TypeError(`Pezzo ${nome} mancante`);
  }
  return trovato.shape;
};

describe('famiglia fibbia', () => {
  it('should build the default buckle as a valid frame and pin with the declared size', () => {
    const p = fibbia.predefiniti();
    const valutazione = valutaFamiglia(lib, fibbia, p);
    expect(valutazione.pezzi.map(({ name }) => name)).toEqual(['Telaio', 'Ardiglione']);
    const telaio = pezzo(valutazione, 'Telaio');
    const ardiglione = pezzo(valutazione, 'Ardiglione');
    expect(telaio.isValid() && ardiglione.isValid()).toBe(true);
    expect(telaio.solids()).toHaveLength(1);
    expect(ardiglione.solids()).toHaveLength(1);
    const luce = valoriDerivati(fibbia.parametri, p)['telaio.luce'];
    expect(luce).toBe(p.cinturino.larghezza + 1);
    const w = p.telaio.sezioneLarghezza;
    const { size } = telaio.bbox();
    expect(size.x).toBeCloseTo(21 + 2 * w, 3);
    expect(size.y).toBeCloseTo(p.telaio.altezzaInterna + 2 * w, 3);
    expect(size.z).toBeCloseTo(p.telaio.sezioneSpessore, 3);
    // Zamak frame, steel pin: densities of the materials table.
    expect(valutazione.pezzi.map(({ materiale, density }) => [materiale, density])).toEqual([
      ['zama', 6.7],
      ['acciaio', 7.85],
    ]);
    expect(valutazione.esiti.filter(({ livello }) => livello === 'blocco')).toEqual([]);
    const codici = new Set(valutazione.esiti.map(({ codice }) => codice));
    for (const codice of [
      'PARETE_MIN',
      'SFORMO',
      'RAGGI_MIN',
      'ARDIGLIONE_D',
      'INTERFERENZA',
      'SOLIDO_CHIUSO',
      'PESO',
    ]) {
      expect(codici).toContain(codice);
    }
    // Drafted about the mid-plane by 1 degree: every face releases from its half of the die.
    expect(valutazione.esiti.find(({ codice }) => codice === 'SFORMO')?.livello).toBe('ok');
    // The pin's straight run passes above the frame (its eye wraps under the bar), its tip over the opposite bar.
    const sopra = ardiglione.section(lib.Plane.XZ.offset(-(p.telaio.altezzaInterna / 2))).bbox();
    expect(sopra.min.z).toBeGreaterThan(p.telaio.sezioneSpessore);
    expect(ardiglione.bbox().max.y).toBeCloseTo(p.telaio.altezzaInterna / 2 + w / 2 + 1, 3);
  });

  it('should rebuild the default buckle within the 300 ms budget', () => {
    const p = fibbia.predefiniti();
    fibbia.costruisci(lib, p);
    const inizio = performance.now();
    fibbia.costruisci(lib, p);
    expect(performance.now() - inizio).toBeLessThan(300);
  });

  it.each(['ovale', 'a_d', 'doppia'] as const)('should build the %s variant as valid single solids', (variante) => {
    const valutazione = valutaFamiglia(lib, fibbia, fibbia.predefiniti(variante), { variante });
    expect(valutazione.pezzi).toHaveLength(2);
    for (const { shape } of valutazione.pezzi) {
      expect(shape instanceof lib.Part && shape.isValid() && shape.solids().length === 1).toBe(true);
    }
    expect(valutazione.esiti.filter(({ livello }) => livello === 'blocco')).toEqual([]);
  });

  it('should build round and flat sections', () => {
    for (const profilo of ['tondo', 'piatto'] as const) {
      const p = fibbia.normalizza({ telaio: { profilo } });
      const valutazione = valutaFamiglia(lib, fibbia, p);
      const telaio = pezzo(valutazione, 'Telaio');
      expect(telaio.isValid()).toBe(true);
      expect(telaio.bbox().size.z).toBeCloseTo(p.telaio.sezioneSpessore, 3);
      expect(valutazione.esiti.filter(({ livello }) => livello === 'blocco')).toEqual([]);
    }
  });

  it('should warn when the zamak section is 1 mm', () => {
    const p = fibbia.normalizza({ telaio: { sezioneSpessore: 1.2, sezioneLarghezza: 1.5 } });
    p.telaio.sezioneSpessore = 1;
    const esiti = fibbia.verifiche(lib, fibbia.costruisci(lib, p), p);
    const parete = esiti.find(({ codice }) => codice === 'PARETE_MIN');
    expect(parete).toMatchObject({ livello: 'avviso', valore: 1, soglia: 1.2 });
  });

  it('should bring parameters back inside their limits and constraints', () => {
    const p = fibbia.normalizza({
      cinturino: { larghezza: 80 },
      telaio: { raggioAngoli: 30, sezioneSpessore: 6, sezioneLarghezza: 2 },
    });
    expect(p.cinturino.larghezza).toBe(60);
    expect(p.telaio.sezioneSpessore).toBe(4);
    expect(p.telaio.raggioAngoli).toBe(p.telaio.altezzaInterna / 2);
    expect(fibbia.vincoli(p)).toEqual([]);
    expect(fibbia.schema.safeParse(p).success).toBe(true);
  });

  it('should reproduce the frame of the pilot buckle within 2 % of its volume', async () => {
    const percorso = new URL(
      '../../../../../libs/tau-examples/src/kernels/smlib/manual-buckle-fixture/main.ts',
      import.meta.url,
    ).href;
    const pilota = (await import(/* @vite-ignore */ percorso)) as {
      default: () => { name: string; shape: Smlib.Part }[];
    };
    const telaioPilota = pilota.default().find(({ name }) => name === 'Telaio fibbia')!.shape;
    const { variante, parametri } = presetPilotaFibbia;
    const valutazione = valutaFamiglia(lib, fibbia, parametri, { variante });
    const telaio = pezzo(valutazione, 'Telaio');
    expect(Math.abs(telaio.volume / telaioPilota.volume - 1)).toBeLessThan(0.02);
    const atteso = telaioPilota.bbox().size;
    expect(telaio.bbox().size.x).toBeCloseTo(atteso.x, 3);
    expect(telaio.bbox().size.y).toBeCloseTo(atteso.y, 3);
    expect(telaio.bbox().size.z).toBeCloseTo(atteso.z, 3);
    // The pin hinges on the centre bar and reaches the far rail, clear of the frame.
    const ardiglione = pezzo(valutazione, 'Ardiglione');
    expect(ardiglione.bbox().min.y).toBeLessThan(0);
    expect(valutazione.esiti.find(({ codice }) => codice === 'INTERFERENZA')?.livello).toBe('ok');
  });

  it('should export the pieces to STEP and read them back', () => {
    const { esito, corpi } = rileggiStep(lib, fibbia.costruisci(lib, fibbia.predefiniti()), 'fibbia');
    expect(esito.livello).toBe('ok');
    expect(corpi).toHaveLength(2);
  });

  it('should emit the project main.ts of the family', () => {
    const p: ParametriFibbia = fibbia.predefiniti('doppia');
    const codice = fibbia.emettiMain(
      p,
      { 'cinturino.larghezza': 'Dalla misura dichiarata, 20 mm.' },
      { variante: 'doppia' },
    );
    expect(codice).toContain("import { fibbia } from '@sinopia/famiglie';");
    expect(codice).toContain('traversino: { abilitato: true');
    expect(codice).toContain("variante: 'doppia'");
  });
});
