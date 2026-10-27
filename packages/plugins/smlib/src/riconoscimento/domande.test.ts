// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { catalogoFamiglie } from '#riconoscimento/contratto.js';
import { domandaFamiglia, domandeParametri, prossimaDomanda } from '#riconoscimento/domande.js';
import { schedaRiconoscimentoDiProva } from '#riconoscimento/esempi.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';
import { soglie, statoValore } from '#riconoscimento/soglie.js';

const catalogo = catalogoFamiglie();
const tacco = catalogo.find((famiglia) => famiglia.id === 'tacco')!;
const fibbia = catalogo.find((famiglia) => famiglia.id === 'fibbia')!;
const critici = tacco.parametri.filter((parametro) => parametro.critico && parametro.unita === 'mm');

const schedaTacco = (confidenze: number[]): SchedaRiconoscimento => ({
  ...schedaRiconoscimentoDiProva,
  famiglia: { id: 'tacco', confidenza: 0.9, alternative: [] },
  variante: { id: 'stiletto', confidenza: 0.9 },
  scala: { pxPerMm: 4, fonte: 'misura_nota', riferimento: '85 mm', confidenza: 0.95 },
  parametri: critici.slice(0, confidenze.length).map((parametro, indice) => ({
    chiave: parametro.chiave,
    valore: Number(parametro.default),
    confidenza: confidenze[indice]!,
    fonte: 'proporzione',
    motivo: `motivo ${indice}`,
  })),
  domande: [],
});

describe('soglie e stato dei valori', () => {
  it('should mark measured, estimated and assumed values at 0.6 and 0.8', () => {
    expect(soglie).toMatchObject({ famiglia: 0.6, critico: 0.6, nonCritico: 0.8, domandeMassime: 3 });
    expect(statoValore({ confidenza: 0.7, fonte: 'catalogo' })).toBe('misurata');
    expect(statoValore({ confidenza: 0.85, fonte: 'proporzione' })).toBe('misurata');
    expect(statoValore({ confidenza: 0.7, fonte: 'proporzione' })).toBe('stimata');
    expect(statoValore({ confidenza: 0.59, fonte: 'proporzione' })).toBe('ipotesi');
    expect(statoValore({ confidenza: 0.9, fonte: 'non_visibile' })).toBe('ipotesi');
    expect(statoValore({ confidenza: 0.9, fonte: 'proporzione' }, { scalaStimata: true, unita: 'mm' })).toBe('ipotesi');
    expect(statoValore({ confidenza: 0.9, fonte: 'proporzione' }, { scalaStimata: true, unita: 'deg' })).toBe(
      'misurata',
    );
  });
});

describe('domande del riconoscimento', () => {
  it('should ask the family before building only under 0.6, with at most three families and «Altro»', () => {
    expect(domandaFamiglia(schedaRiconoscimentoDiProva)).toBeUndefined();
    const incerta: SchedaRiconoscimento = {
      ...schedaRiconoscimentoDiProva,
      famiglia: {
        id: 'tacco',
        confidenza: 0.45,
        alternative: [
          { id: 'fondo_semplice', confidenza: 0.3 },
          { id: 'libero', confidenza: 0.1 },
        ],
      },
    };
    expect(domandaFamiglia(incerta)).toStrictEqual({
      tipo: 'famiglia',
      opzioni: ['tacco', 'fondo_semplice', 'libero'],
    });
  });

  it('should ask only critical parameters under 0.6, least sure first, at most three, minus the answered ones', () => {
    expect(critici.length).toBeGreaterThanOrEqual(4);
    const scheda = schedaTacco([0.5, 0.2, 0.9, 0.4, 0.1]);
    const domande = domandeParametri(scheda, tacco);
    expect(domande.map((domanda) => domanda.chiave)).toStrictEqual([
      critici[4]!.chiave,
      critici[1]!.chiave,
      critici[3]!.chiave,
    ]);
    expect(domandeParametri(scheda, tacco, new Set([critici[4]!.chiave])).map((d) => d.chiave)[0]).toBe(
      critici[1]!.chiave,
    );
    for (const domanda of domande) {
      expect(domanda.proposte[0]).toBeLessThan(domanda.proposte[1]);
      expect(domanda.proposte[1]).toBeLessThan(domanda.proposte[2]);
    }
  });

  it('should reuse the proposals of the classifier and fall back to the min–max band', () => {
    const [larghezza] = domandeParametri(schedaRiconoscimentoDiProva, fibbia);
    expect(larghezza).toMatchObject({
      chiave: 'cinturino.larghezza',
      proposte: [18, 19, 20],
      unita: 'mm',
      min: 8,
      max: 60,
    });
    const senza = { ...schedaRiconoscimentoDiProva, domande: [] };
    expect(domandeParametri(senza, fibbia)[0]!.proposte).toStrictEqual([17.5, 19, 20.5]);
  });

  it('should go family → parameters → estimated scale, one at a time, three parameter questions at most', () => {
    const stimata: SchedaRiconoscimento = {
      ...schedaTacco([0.2, 0.3, 0.4, 0.5]),
      scala: { pxPerMm: 3, fonte: 'stima', riferimento: '', confidenza: 0.4 },
    };
    const risposte = new Set<string>();
    const viste: string[] = [];
    for (let giro = 0; giro < 6; giro++) {
      const domanda = prossimaDomanda(stimata, tacco, { risposte, scalaData: viste.includes('scala') });
      if (!domanda) {
        break;
      }
      viste.push(domanda.tipo === 'parametro' ? domanda.chiave : domanda.tipo);
      if (domanda.tipo === 'parametro') {
        risposte.add(domanda.chiave);
      }
    }
    expect(viste).toStrictEqual([critici[0]!.chiave, critici[1]!.chiave, critici[2]!.chiave, 'scala']);
    const incerta: SchedaRiconoscimento = { ...stimata, famiglia: { id: 'tacco', confidenza: 0.3, alternative: [] } };
    expect(prossimaDomanda(incerta, tacco, { risposte: new Set() })?.tipo).toBe('famiglia');
    expect(prossimaDomanda(incerta, tacco, { risposte: new Set(), famigliaScelta: true })?.tipo).toBe('parametro');
  });
});
