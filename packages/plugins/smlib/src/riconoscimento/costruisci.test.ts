// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseAssumptionDescription } from '#parameter-assumptions.js';
import { pianoCostruzione } from '#riconoscimento/costruisci.js';
import { schedaRiconoscimentoDiProva } from '#riconoscimento/esempi.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';

const attributi = (valore: string | undefined) =>
  parseAssumptionDescription(`[sinopia:assumed${valore?.startsWith('[') ? ` ${valore.slice(1)}` : `] ${valore}`}`);

describe('piano di costruzione di un pezzo riconosciuto', () => {
  it('should build the recognised buckle with the family registry and import @sinopia/famiglie', () => {
    const piano = pianoCostruzione(schedaRiconoscimentoDiProva)!;
    expect(piano).toMatchObject({ famiglia: 'fibbia', variante: 'rettangolare', versione: 1 });
    expect(piano.parametri).toMatchObject({
      cinturino: { larghezza: 19 },
      telaio: { altezzaInterna: 14, profilo: 'bombato' },
    });
    expect(piano.main).toContain("import { fibbia } from '@sinopia/famiglie';");
    expect(piano.main).toContain("fibbia.costruisci(p, { variante: 'rettangolare' })");
    expect(piano.vincoli).toStrictEqual([]);
  });

  it('should mark every value that is not measured, with confidence, source and band in the marker', () => {
    const { ipotesi } = pianoCostruzione(schedaRiconoscimentoDiProva)!;
    expect(attributi(ipotesi['cinturino.larghezza'])).toStrictEqual({
      confidence: 0.52,
      source: 'proporzione',
      min: 18,
      max: 21,
      reason: 'Il cinturino è in parte coperto dal telaio: larghezza letta sul tratto visibile.',
    });
    expect(attributi(ipotesi['telaio.sezioneSpessore'])).toMatchObject({ confidence: 0.35, source: 'non_visibile' });
    // Measured from the catalogue and very sure: no marker.
    expect(ipotesi['telaio.sezioneLarghezza']).toBeUndefined();
    // Not read from the photo: a craft default, said so.
    expect(attributi(ipotesi['costruzione.sformo'])).toMatchObject({ source: 'default_mestiere', confidence: 0.3 });
    // Derived parameters are never assumptions.
    expect(ipotesi['telaio.luce']).toBeUndefined();
  });

  it('should take the answers to the chips as the designer’s values, without a marker', () => {
    const piano = pianoCostruzione(schedaRiconoscimentoDiProva, { risposte: { 'cinturino.larghezza': 20 } })!;
    expect(piano.parametri).toMatchObject({ cinturino: { larghezza: 20 } });
    expect(piano.ipotesi['cinturino.larghezza']).toBeUndefined();
  });

  it('should bring a value back within the recipe and say so', () => {
    const scheda = structuredClone(schedaRiconoscimentoDiProva);
    scheda.parametri[0]!.valore = 75;
    scheda.parametri[0]!.confidenza = 0.95;
    scheda.parametri[0]!.fonte = 'catalogo';
    const piano = pianoCostruzione(scheda, { lingua: 'en' })!;
    expect(piano.parametri).toMatchObject({ cinturino: { larghezza: 60 } });
    expect(attributi(piano.ipotesi['cinturino.larghezza'])).toMatchObject({
      source: 'default_mestiere',
      confidence: 0.3,
    });
    expect(piano.ipotesi['cinturino.larghezza']).toContain('Brought back within the recipe limits');
  });

  it('should keep the variant default for a value the photo does not show, with the model’s reason', () => {
    // A block heel seen from the side: the seat outline and the widths are not visible, the model echoes the base
    // defaults of the family sheet (an ellipse, the stiletto's 48 mm). The block keeps its own shield seat.
    const scheda: SchedaRiconoscimento = {
      ...schedaRiconoscimentoDiProva,
      famiglia: { id: 'tacco', confidenza: 0.9, alternative: [] },
      variante: { id: 'blocco', confidenza: 0.9 },
      parametri: [
        { chiave: 'tacco.altezza', valore: 67, confidenza: 0.6, fonte: 'proporzione', motivo: 'Altezza al dorso' },
        {
          chiave: 'seduta.forma',
          valore: 'ellisse',
          confidenza: 0.3,
          fonte: 'non_visibile',
          motivo: 'La pianta non si vede di fianco.',
        },
        {
          chiave: 'tappo.larghezza',
          valore: 10,
          confidenza: 0.3,
          fonte: 'non_visibile',
          motivo: 'Non si vede di fianco.',
        },
      ],
    };
    const piano = pianoCostruzione(scheda)!;
    expect(piano.variante).toBe('blocco');
    expect(piano.parametri).toMatchObject({
      tacco: { altezza: 67 },
      seduta: { forma: 'scudo' },
      tappo: { larghezza: 42 },
    });
    expect(attributi(piano.ipotesi['tappo.larghezza'])).toMatchObject({
      source: 'non_visibile',
      confidence: 0.3,
      reason: 'Non si vede di fianco.',
    });
  });

  it('should build a family the designer chose at the chip from its defaults, and nothing for a free part', () => {
    const scelta = pianoCostruzione(schedaRiconoscimentoDiProva, { famiglia: 'placca' })!;
    expect(scelta.famiglia).toBe('placca');
    expect(scelta.variante).toBe('rettangolo');
    const libero: SchedaRiconoscimento = {
      ...schedaRiconoscimentoDiProva,
      famiglia: { id: 'libero', confidenza: 0.8, alternative: [] },
    };
    expect(pianoCostruzione(libero)).toBeUndefined();
  });

  it('should carry the recognised material to the family, adapting the process rather than losing the material', () => {
    // The recorded buckle is brass: the default process (zama die casting) cannot cast brass, so the process follows.
    const fibbia = pianoCostruzione(schedaRiconoscimentoDiProva)!;
    expect(fibbia.parametri).toMatchObject({ costruzione: { materiale: 'ottone', processo: 'fusione_cera_persa' } });
    expect(fibbia.vincoli).toStrictEqual([]);
    // A ring takes it in `lega`; with confidence under 0.5 the recognition is not trusted and the default stays.
    const anello: SchedaRiconoscimento = {
      ...schedaRiconoscimentoDiProva,
      famiglia: { id: 'anello', confidenza: 0.9, alternative: [] },
      variante: { id: 'griffe', confidenza: 0.8 },
      parametri: [],
      materiale: { chiave: 'oro_18kt_rosa', confidenza: 0.8 },
    };
    expect(pianoCostruzione(anello)!.parametri).toMatchObject({ lega: 'oro_18kt_rosa' });
    expect(
      pianoCostruzione({ ...anello, materiale: { chiave: 'oro_18kt_rosa', confidenza: 0.3 } })!.parametri,
    ).not.toMatchObject({ lega: 'oro_18kt_rosa' });
    // A material the family does not admit is ignored.
    expect(
      pianoCostruzione({ ...schedaRiconoscimentoDiProva, materiale: { chiave: 'cuoio', confidenza: 0.9 } })!.parametri,
    ).toMatchObject({ costruzione: { materiale: 'zama', processo: 'pressofusione_zama' } });
  });
});
