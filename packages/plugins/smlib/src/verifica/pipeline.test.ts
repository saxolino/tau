// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { consegnaVerifica, esitoDaIou, richiestaDaScheda } from '#verifica/pipeline.js';
import type { SchedaPerVerifica } from '#verifica/pipeline.js';

const scheda: SchedaPerVerifica = {
  famiglia: { id: 'tacco', confidenza: 0.9 },
  variante: { id: 'stiletto', confidenza: 0.8 },
  vista: { azimuth: 85, elevation: 5, rollo: 0, confidenza: 0.7, latiOcclusi: ['alto'] },
  scala: { pxPerMm: 4.2, fonte: 'misura_nota' },
  parametri: [
    { chiave: 'tacco.altezza', valore: 84, min: 80, max: 90, confidenza: 0.95, fonte: 'misura_nota' },
    { chiave: 'seduta.lunghezza', valore: 55, confidenza: 0.5, fonte: 'proporzione' },
    { chiave: 'seduta.larghezza', valore: 48, confidenza: 0.3, fonte: 'non_visibile' },
    { chiave: 'anima.diametro', valore: 5, confidenza: 0.4, fonte: 'default_mestiere' },
  ],
};

const risposta = (iou: number) => ({
  famiglia: 'tacco' as const,
  variante: 'stiletto',
  iou,
  chiaviOttimizzate: ['tacco.altezza', 'seduta.lunghezza', 'seduta.larghezza'],
  parametri: { tacco: { altezza: 85.2 }, seduta: { lunghezza: 53.1, larghezza: 47 }, anima: { diametro: 5 } },
});

describe('soglie della verifica', () => {
  it('should accept from 0.92, accept with reserve from 0.85, and ask the model again once below', () => {
    expect(esitoDaIou(0.92, 0)).toBe('accettato');
    expect(esitoDaIou(0.9199, 0)).toBe('riserva');
    expect(esitoDaIou(0.85, 1)).toBe('riserva');
    expect(esitoDaIou(0.8499, 0)).toBe('rientro');
    expect(esitoDaIou(0.8499, 1)).toBe('avviso');
  });
});

describe('dalla scheda del classificatore alla richiesta', () => {
  it('should nest the parameters, carry confidences, plausible intervals and the hidden ones', () => {
    const png = Uint8Array.of(1, 2, 3);
    const richiesta = richiestaDaScheda(scheda, png, { budgetMs: 30_000 })!;
    expect(richiesta.famiglia).toBe('tacco');
    expect(richiesta.variante).toBe('stiletto');
    expect(richiesta.stima.parametri).toEqual({
      tacco: { altezza: 84 },
      seduta: { lunghezza: 55, larghezza: 48 },
      anima: { diametro: 5 },
    });
    expect(richiesta.stima.confidenze).toEqual({
      'tacco.altezza': 0.95,
      'seduta.lunghezza': 0.5,
      'seduta.larghezza': 0.3,
      'anima.diametro': 0.4,
    });
    expect(richiesta.stima.intervalli).toEqual({ 'tacco.altezza': [80, 90] });
    expect(richiesta.stima.nonVisibili).toEqual(['seduta.larghezza']);
    expect(richiesta.scala).toEqual({ pxPerMmFoto: 4.2, fonte: 'misura_nota' });
    expect(richiesta.vista.latiOcclusi).toEqual(['alto']);
    expect(richiesta.maschera.png).toBe(png);
    expect(richiesta.opzioni).toEqual({ budgetMs: 30_000 });
  });

  it('should not verify a free-form or non-modelable part', () => {
    expect(richiestaDaScheda({ ...scheda, famiglia: { id: 'libero', confidenza: 0.7 } }, new Uint8Array())).toBeNull();
    expect(
      richiestaDaScheda({ ...scheda, famiglia: { id: 'non_modellabile', confidenza: 0.7 } }, new Uint8Array()),
    ).toBeNull();
  });
});

describe('consegna', () => {
  it('should mark the optimised parameters as from the silhouette when accepted', () => {
    const consegna = consegnaVerifica(scheda, risposta(0.95), 'accettato');
    const perChiave = Object.fromEntries(consegna.parametri.map((parametro) => [parametro.chiave, parametro]));
    expect(perChiave['tacco.altezza']).toEqual({
      chiave: 'tacco.altezza',
      valore: 85.2,
      fonte: 'silhouette',
      confidenza: 0.9,
      stato: 'misurata',
    });
    expect(perChiave['seduta.lunghezza']!.valore).toBe(53.1);
    // Not optimised: stays the classifier's, with its own confidence.
    expect(perChiave['anima.diametro']).toEqual({
      chiave: 'anima.diametro',
      valore: 5,
      fonte: 'default_mestiere',
      confidenza: 0.4,
      stato: 'ipotesi',
    });
    expect(consegna.chip).toEqual([]);
    expect(consegna.messaggio).toBe('Combacia con la foto (IoU 0,95).');
  });

  it('should keep the values but leave them estimated and ask about the view when accepted with reserve', () => {
    const consegna = consegnaVerifica(scheda, risposta(0.88), 'riserva');
    const altezza = consegna.parametri.find((parametro) => parametro.chiave === 'tacco.altezza')!;
    expect(altezza).toMatchObject({ valore: 85.2, fonte: 'silhouette', confidenza: 0.7, stato: 'stimata' });
    expect(consegna.chip.map((chip) => chip.codice)).toEqual(['VISTA']);
    expect(consegna.chip[0]!.proposte).toEqual(['fianco', '3/4', 'dietro']);
  });

  it('should keep the best values from the classifier sources and offer three ways out when it does not match', () => {
    const consegna = consegnaVerifica(scheda, risposta(0.78), 'avviso');
    const altezza = consegna.parametri.find((parametro) => parametro.chiave === 'tacco.altezza')!;
    expect(altezza).toMatchObject({ valore: 85.2, fonte: 'misura_nota', stato: 'misurata' });
    expect(consegna.chip.map((chip) => chip.codice)).toEqual(['TIPO', 'FOTO', 'LIBERO']);
    expect(consegna.messaggio).toBe('Non combacia bene (IoU 0,78).');
  });
});
