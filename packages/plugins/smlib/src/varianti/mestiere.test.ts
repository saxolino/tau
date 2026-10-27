// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Esito, FamigliaQualsiasi } from '#famiglie/famiglia.js';
import { anello } from '#famiglie/anello.js';
import { fibbia } from '#famiglie/fibbia.js';
import { leggiParametro } from '#famiglie/parametri.js';
import { placca } from '#famiglie/placca.js';
import { famiglie } from '#famiglie/registro.js';
import { normalizzati } from '#varianti/assi.js';
import { candidatiCorrezione, materialeFamiglia, provaMateriale } from '#varianti/mestiere.js';

/** Every family of the registry, as `[id, family]` rows for `it.each`. */
const tutteLeFamiglie = Object.entries(famiglie).map(([id, famiglia]) => [id, famiglia] as [string, FamigliaQualsiasi]);

const pareteSottile: Esito = {
  livello: 'blocco',
  codice: 'PARETE_MIN',
  pezzo: 'Telaio',
  valore: 0.6,
  soglia: 0.8,
  messaggio: 'Sezione del telaio 0,6 mm: sotto il minimo di 0,8 mm.',
};

describe('candidatiCorrezione', () => {
  it('should bring the thin side of the buckle’s section up to the minimum, on the parameter’s step', () => {
    // The defaults (3 × 2,5 mm) measure 2,5 mm, above a 0,8 mm minimum already: nothing to correct.
    expect(
      candidatiCorrezione(fibbia, { attuali: fibbia.predefiniti(), esito: { ...pareteSottile, valore: 2.5 } }),
    ).toEqual([]);
    const sottile = fibbia.normalizza({ telaio: { sezioneLarghezza: 1.5, sezioneSpessore: 1.2 } });
    const [primo] = candidatiCorrezione(fibbia, {
      attuali: sottile,
      esito: { ...pareteSottile, valore: 1.2, soglia: 1.65 },
    });
    expect(primo?.modifiche).toEqual([
      { chiave: 'telaio.sezioneSpessore', prima: 1.2, dopo: 1.7 },
      { chiave: 'telaio.sezioneLarghezza', prima: 1.5, dopo: 1.7 },
    ]);
    expect(primo).toMatchObject({ codice: 'PARETE_MIN', pezzo: 'Telaio', soglia: 1.65 });
  });

  it('should say nothing for an ok outcome, an unknown code or one without a threshold', () => {
    const p = fibbia.predefiniti();
    expect(candidatiCorrezione(fibbia, { attuali: p, esito: { ...pareteSottile, livello: 'ok' } })).toEqual([]);
    expect(candidatiCorrezione(fibbia, { attuali: p, esito: { ...pareteSottile, codice: 'GALVANICA' } })).toEqual([]);
    const { soglia: _soglia, ...senzaSoglia } = pareteSottile;
    expect(candidatiCorrezione(fibbia, { attuali: p, esito: senzaSoglia })).toEqual([]);
  });

  it('should also scale a measure that is a fraction of its parameter: a tapered ring shank', () => {
    // The shank's bottom is spessore × rastremazione = 1 × 0,8 = 0,8 mm against a 1,2 mm minimum.
    const p = anello.normalizza({ gambo: { spessore: 1, rastremazione: 0.8 } });
    const candidati = candidatiCorrezione(anello, {
      attuali: p,
      esito: { livello: 'avviso', codice: 'GAMBO_MIN', valore: 0.8, soglia: 1.2, messaggio: '' },
    });
    expect(candidati.map((candidato) => candidato.modifiche)).toEqual([
      [{ chiave: 'gambo.spessore', prima: 1, dopo: 1.2 }],
      [{ chiave: 'gambo.spessore', prima: 1, dopo: 1.5 }],
    ]);
  });
});

describe('provaMateriale', () => {
  it('should try a gold ring in silver 925 and a silver one in gold', () => {
    expect(provaMateriale(anello, anello.predefiniti())).toEqual({
      materiale: 'argento_925',
      modifiche: [{ chiave: 'lega', prima: 'oro_18kt_giallo', dopo: 'argento_925' }],
    });
    expect(provaMateriale(anello, anello.normalizza({ lega: 'argento_925' }))?.materiale).toBe('oro_18kt_giallo');
  });

  it('should change the process too when the material asks for it: a brass plate is cast, not die-cast', () => {
    const prova = provaMateriale(placca, placca.predefiniti());
    expect(prova?.materiale).toBe('ottone');
    expect(prova?.modifiche).toEqual([
      { chiave: 'costruzione.materiale', prima: 'zama', dopo: 'ottone' },
      { chiave: 'costruzione.processo', prima: 'pressofusione_zama', dopo: 'tranciatura_lamiera' },
    ]);
    const p = placca.predefiniti();
    expect(
      placca.vincoli(
        placca.normalizza({
          ...p,
          costruzione: { ...p.costruzione, materiale: 'ottone', processo: 'tranciatura_lamiera' },
        }),
      ),
    ).toEqual([]);
  });

  it('should read a buckle’s material from its process and try the other one', () => {
    const p = fibbia.predefiniti();
    expect(materialeFamiglia(fibbia, p)).toBe('zama');
    expect(provaMateriale(fibbia, p)).toEqual({
      materiale: 'ottone',
      modifiche: [{ chiave: 'costruzione.processo', prima: 'pressofusione_zama', dopo: 'fusione_cera_persa' }],
    });
  });

  it.each(tutteLeFamiglie)('should give %s a material to try that its constraints accept', (_id, famiglia) => {
    const p: unknown = famiglia.predefiniti();
    const prova = provaMateriale(famiglia, p);
    expect(prova).toBeDefined();
    const provato = structuredClone(normalizzati(famiglia, p));
    for (const modifica of prova!.modifiche) {
      const [testa, ...resto] = modifica.chiave.split('.');
      if (resto.length === 0) {
        (provato as Record<string, unknown>)[testa!] = modifica.dopo;
      } else {
        (provato as Record<string, Record<string, unknown>>)[testa!]![resto.join('.')] = modifica.dopo;
      }
    }
    const normalizzato = normalizzati(famiglia, provato);
    expect(famiglia.vincoli(normalizzato).length).toBeLessThanOrEqual(
      famiglia.vincoli(normalizzati(famiglia, p)).length,
    );
    expect(materialeFamiglia(famiglia, normalizzato)).toBe(prova!.materiale);
    expect(leggiParametro(normalizzato, prova!.modifiche[0]!.chiave)).toBe(prova!.modifiche[0]!.dopo);
  });
});
