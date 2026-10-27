// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { catalogoFamiglie } from '#riconoscimento/contratto.js';
import { pianoCostruzione } from '#riconoscimento/costruisci.js';
import { schedaRiconoscimentoDiProva } from '#riconoscimento/esempi.js';
import { riscalaScheda } from '#riconoscimento/riscala.js';
import { pxPerMmDaMisura } from '#riconoscimento/scala.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';

const fibbia = catalogoFamiglie().find((famiglia) => famiglia.id === 'fibbia')!;
// The classifier guessed 8 px/mm; the designer then says the part is 30 mm wide, which the mask measures at 240 px.
const stimata: SchedaRiconoscimento = {
  ...schedaRiconoscimentoDiProva,
  scala: { pxPerMm: 8, fonte: 'stima', riferimento: 'cinturino 20 mm', confidenza: 0.4 },
};

describe('riscalare un pezzo con la misura nota', () => {
  it('should bring the mm values to the new scale and leave angles, fractions and counts alone', () => {
    const maschera = { larghezza: 100, altezza: 100, dati: new Uint8Array(100 * 100) };
    for (let y = 40; y < 60; y++) {
      maschera.dati.fill(1, y * 100 + 10, y * 100 + 70);
    }
    const nuova = pxPerMmDaMisura(maschera, { valoreMm: 30, cosa: 'larghezza' })!;
    expect(nuova).toBe(2);
    const scheda = riscalaScheda(stimata, { pxPerMm: nuova, riferimento: '30 mm larghezza' }, fibbia);
    expect(scheda.scala).toMatchObject({ pxPerMm: 2, fonte: 'misura_nota', confidenza: 0.95 });
    // The photo did not change: 19 mm at 8 px/mm are 152 px, which at 2 px/mm are 76 mm.
    const larghezza = scheda.parametri.find((parametro) => parametro.chiave === 'cinturino.larghezza')!;
    expect(larghezza).toMatchObject({ valore: 76, min: 72, max: 84 });
    // The profile is a word, the corner radius stays in mm and scales too.
    expect(scheda.parametri.find((parametro) => parametro.chiave === 'telaio.profilo')!.valore).toBe('bombato');
    expect(scheda.parametri.find((parametro) => parametro.chiave === 'telaio.raggioAngoli')!.valore).toBe(10);
  });

  it('should keep the values when the first scale was unknown, and let the build take the new scale', () => {
    const senza: SchedaRiconoscimento = { ...stimata, scala: { ...stimata.scala, pxPerMm: null } };
    const scheda = riscalaScheda(senza, { pxPerMm: 2, riferimento: '30 mm' }, fibbia);
    expect(scheda.parametri.find((parametro) => parametro.chiave === 'cinturino.larghezza')!.valore).toBe(19);
    expect(pianoCostruzione(scheda)!.parametri).toMatchObject({ cinturino: { larghezza: 19 } });
  });
});
