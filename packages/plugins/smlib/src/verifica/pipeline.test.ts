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

const voce = (chiave: string, degrado: number, banda: readonly [number, number] = [0, 100]) => ({
  chiave,
  sensibilita: degrado,
  degrado,
  osservabile: degrado >= 0.025,
  banda,
});

// A side view: the heel height and the seat length are fixed by the silhouette; the seat width is not.
const risposta = (iou: number) => ({
  famiglia: 'tacco' as const,
  variante: 'stiletto',
  iou,
  chiaviOttimizzate: ['seduta.lunghezza', 'seduta.larghezza'],
  parametri: { tacco: { altezza: 84 }, seduta: { lunghezza: 53.1, larghezza: 47 }, anima: { diametro: 5 } },
  sensibilita: [voce('seduta.lunghezza', 0.03), voce('seduta.larghezza', 0.002, [38, 58])],
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
    // A measure declared by the photo's own source (here the heel height) is the scale itself: it is never moved.
    expect(richiesta.opzioni?.budgetMs).toBe(30_000);
    expect(richiesta.opzioni?.chiavi).not.toContain('tacco.altezza');
    expect(richiesta.opzioni?.chiavi).toContain('seduta.lunghezza');
  });

  it('should not verify a free-form or non-modelable part', () => {
    expect(richiestaDaScheda({ ...scheda, famiglia: { id: 'libero', confidenza: 0.7 } }, new Uint8Array())).toBeNull();
    expect(
      richiestaDaScheda({ ...scheda, famiglia: { id: 'non_modellabile', confidenza: 0.7 } }, new Uint8Array()),
    ).toBeNull();
  });
});

describe('consegna', () => {
  it('should mark as from the silhouette only the parameters the view fixes, when accepted', () => {
    const consegna = consegnaVerifica(scheda, risposta(0.95), 'accettato');
    const perChiave = Object.fromEntries(consegna.parametri.map((parametro) => [parametro.chiave, parametro]));
    expect(perChiave['seduta.lunghezza']).toEqual({
      chiave: 'seduta.lunghezza',
      valore: 53.1,
      fonte: 'silhouette',
      confidenza: 0.9,
      stato: 'misurata',
    });
    // The photo's own measure stays the classifier's.
    expect(perChiave['tacco.altezza']).toMatchObject({ fonte: 'misura_nota', stato: 'misurata', valore: 84 });
    expect(consegna.chip).toEqual([]);
    expect(consegna.messaggio).toBe('Combacia con la foto (IoU 0,95).');
  });

  it('should keep a parameter the optimiser moved but the view does not see as an assumption with its band', () => {
    const consegna = consegnaVerifica(scheda, risposta(0.95), 'accettato');
    const larghezza = consegna.parametri.find((parametro) => parametro.chiave === 'seduta.larghezza')!;
    expect(larghezza).toMatchObject({ stato: 'ipotesi', fonte: 'non_visibile', min: 38, max: 58 });
    expect(larghezza.confidenza).toBeLessThanOrEqual(0.5);
    expect(consegna.nonOsservabili).toEqual(['seduta.larghezza']);
    // The seat width is a critical measure of the heel: a side photo would fix it.
    expect(consegna.suggerimenti).toEqual(['foto_lato']);
    // Not optimised at all: stays the classifier's, with its own confidence.
    expect(consegna.parametri.find((parametro) => parametro.chiave === 'anima.diametro')).toEqual({
      chiave: 'anima.diametro',
      valore: 5,
      fonte: 'default_mestiere',
      confidenza: 0.4,
      stato: 'ipotesi',
    });
  });

  it('should never call a moved parameter measured without the sensitivity measure', () => {
    const consegna = consegnaVerifica(scheda, { ...risposta(0.95), sensibilita: [] }, 'accettato');
    expect(consegna.parametri.filter((parametro) => parametro.fonte === 'silhouette')).toEqual([]);
    expect(consegna.nonOsservabili).toEqual(['seduta.lunghezza', 'seduta.larghezza']);
  });

  it('should suggest a side photo when a critical measure is not seen from the view', () => {
    const consegna = consegnaVerifica(
      scheda,
      {
        ...risposta(0.95),
        chiaviOttimizzate: ['seduta.lunghezza', 'tappo.larghezza'],
        parametri: { seduta: { lunghezza: 53.1 }, tappo: { larghezza: 33 } },
        sensibilita: [voce('seduta.lunghezza', 0.002, [45, 65]), voce('tappo.larghezza', 0.1)],
      },
      'accettato',
    );
    expect(consegna.nonOsservabili).toEqual(['seduta.lunghezza']);
    expect(consegna.suggerimenti).toEqual(['foto_lato']);
    // A parameter the classifier did not name but the optimiser moved and the view fixes is delivered as measured.
    expect(consegna.parametri.find((parametro) => parametro.chiave === 'tappo.larghezza')).toMatchObject({
      fonte: 'silhouette',
      stato: 'misurata',
      valore: 33,
    });
  });

  it('should keep the values but leave them estimated and ask about the view when accepted with reserve', () => {
    const consegna = consegnaVerifica(scheda, risposta(0.88), 'riserva');
    const lunghezza = consegna.parametri.find((parametro) => parametro.chiave === 'seduta.lunghezza')!;
    expect(lunghezza).toMatchObject({ valore: 53.1, fonte: 'silhouette', confidenza: 0.7, stato: 'stimata' });
    expect(consegna.chip.map((chip) => chip.codice)).toEqual(['VISTA']);
    expect(consegna.chip[0]!.proposte).toEqual(['fianco', '3/4', 'dietro']);
  });

  it('should keep the best values from the classifier sources and offer three ways out when it does not match', () => {
    const consegna = consegnaVerifica(scheda, risposta(0.78), 'avviso');
    const lunghezza = consegna.parametri.find((parametro) => parametro.chiave === 'seduta.lunghezza')!;
    expect(lunghezza).toMatchObject({ valore: 53.1, fonte: 'proporzione' });
    expect(consegna.chip.map((chip) => chip.codice)).toEqual(['TIPO', 'FOTO', 'LIBERO']);
    expect(consegna.messaggio).toBe('Non combacia bene (IoU 0,78).');
  });
});
