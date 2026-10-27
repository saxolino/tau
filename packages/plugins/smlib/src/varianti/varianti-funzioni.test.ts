// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { anello } from '#famiglie/anello.js';
import { fibbia } from '#famiglie/fibbia.js';
import { leggiParametro } from '#famiglie/parametri.js';
import { decodificaPng } from '#verifica/png.js';
import { funzioniVarianti } from '#varianti/varianti-funzioni.js';
import type { RichiestaVarianti } from '#varianti/varianti-funzioni.js';

// Several B-rep builds and renders per test: a loaded machine needs more than the default 5 s.
vi.setConfig({ testTimeout: 90_000 });
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

describe('funzioniVarianti', () => {
  it('should check the current buckle: its warnings, its weight and its size, no previews', async () => {
    const { controlla } = funzioniVarianti(lib);
    const controllo = await controlla({
      famiglia: 'fibbia',
      variante: 'rettangolare',
      parametri: fibbia.predefiniti(),
    });
    expect(controllo.esiti.every((esito) => esito.livello === 'avviso' || esito.livello === 'blocco')).toBe(true);
    expect(controllo.pesoGrammi).toBeGreaterThan(3);
    expect(controllo.pesoGrammi).toBeLessThan(7);
    // The frame is 21 + 2 × 3 = 27 mm across.
    expect(controllo.ingombro?.[0]).toBeCloseTo(27, 0);
  });

  it('should flag a ring shank below the casting minimum and offer the correction that removes it', async () => {
    const { controlla } = funzioniVarianti(lib);
    const controllo = await controlla({
      famiglia: 'anello',
      variante: 'griffe',
      parametri: anello.normalizza({ gambo: { spessore: 1, rastremazione: 0.8 } }, { variante: 'griffe' }),
    });
    expect(controllo.esiti.some((esito) => esito.codice === 'GAMBO_MIN')).toBe(true);
    // Raising the shank to 1,2 mm leaves its tapered bottom at 0,96: the checked correction scales it to 1,5.
    const gambo = controllo.correzioni.find((correzione) => correzione.codice === 'GAMBO_MIN');
    expect(gambo?.modifiche).toEqual([{ chiave: 'gambo.spessore', prima: 1, dopo: 1.5 }]);
  });

  it('should propose three buckles with transparent previews, weights and no new blocking outcome', async () => {
    const { proponi } = funzioniVarianti(lib);
    const attuali = fibbia.predefiniti();
    const esito = await proponi({
      famiglia: 'fibbia',
      variante: 'rettangolare',
      attuali,
      anteprima: { larghezza: 96, altezza: 72 },
    });
    expect(esito.varianti.map((variante) => variante.asse)).toEqual(['slanciata', 'robusta', 'minimale']);
    const immagine = await decodificaPng(esito.attuale.anteprimaPng!);
    expect([immagine.larghezza, immagine.altezza, immagine.canali]).toEqual([96, 72, 4]);
    // The corner is background (transparent), the middle row crosses the frame (opaque somewhere).
    expect(immagine.dati[3]).toBe(0);
    const riga = 36 * 96 * 4;
    expect(Array.from({ length: 96 }, (_, x) => immagine.dati[riga + x * 4 + 3]!).some((alfa) => alfa === 255)).toBe(
      true,
    );
    for (const variante of esito.varianti) {
      expect(variante.anteprimaPng?.length).toBeGreaterThan(100);
      expect(variante.pesoGrammi).toBeGreaterThan(0);
      expect(variante.nuoviBlocchi).toBe(0);
    }
    const [slanciata, robusta] = esito.varianti;
    expect(slanciata!.pesoGrammi!).toBeLessThan(esito.attuale.pesoGrammi!);
    expect(robusta!.pesoGrammi!).toBeGreaterThan(esito.attuale.pesoGrammi!);
  });

  it('should be deterministic: the same request gives the same parameters and the same pixels', async () => {
    const { proponi } = funzioniVarianti(lib);
    const richiesta: RichiestaVarianti = {
      famiglia: 'fibbia',
      attuali: fibbia.predefiniti(),
      assi: ['slanciata'],
      anteprima: { larghezza: 48, altezza: 36 },
    };
    const [prima, seconda] = [await proponi(richiesta), await proponi(richiesta)];
    expect(seconda.varianti[0]!.parametri).toEqual(prima.varianti[0]!.parametri);
    expect(seconda.varianti[0]!.anteprimaPng).toEqual(prima.varianti[0]!.anteprimaPng);
  });

  it('should evaluate the agent’s own sets instead of the local axes, keeping what the designer fixed', async () => {
    const { proponi } = funzioniVarianti(lib);
    const esito = await proponi({
      famiglia: 'fibbia',
      attuali: fibbia.predefiniti(),
      bloccati: ['telaio.sezioneSpessore'],
      insiemi: [
        { id: 'a', titolo: 'Più leggera', parametri: { telaio: { sezioneLarghezza: 2.2, sezioneSpessore: 1.5 } } },
        { id: 'b', titolo: 'Uguale', parametri: { telaio: { sezioneSpessore: 1.5 } } },
      ],
    });
    // The second set only touches a fixed value: it changes nothing and is left out.
    expect(esito.varianti.map((variante) => variante.id)).toEqual(['a']);
    expect(esito.varianti[0]!.origine).toBe('agente');
    expect(leggiParametro(esito.varianti[0]!.parametri, 'telaio.sezioneSpessore')).toBe(2.5);
    expect(esito.varianti[0]!.anteprimaPng).toBeUndefined();
  });
});
