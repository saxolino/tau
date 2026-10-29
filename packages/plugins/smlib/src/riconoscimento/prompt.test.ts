// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { catalogoFamiglie } from '#riconoscimento/contratto.js';
import { schedaFamigliaTesto } from '#riconoscimento/condiviso.js';
import { schedaParteDiProva } from '#riconoscimento/esempi.js';
import { promptPerScheda } from '#riconoscimento/prompt.js';

/** Four characters per token: an offline upper bound (no tokenizer here). */
const tokenStimati = (testo: string): number => Math.ceil(testo.length / 4);

describe('prompt del classificatore', () => {
  it.each(catalogoFamiglie().map((famiglia) => [famiglia.id, famiglia] as const))(
    'should describe the family %s with every critical parameter and stay under 6k tokens',
    (_id, famiglia) => {
      const scheda = schedaFamigliaTesto(famiglia);
      for (const parametro of famiglia.parametri.filter((voce) => voce.critico)) {
        expect(scheda).toContain(`- ${parametro.chiave} — `);
      }
      for (const parametro of famiglia.parametri.filter((voce) => voce.derivato)) {
        expect(scheda).toContain(`- ${parametro.chiave} — ${parametro.unita} — `);
        expect(scheda).toMatch(new RegExp(`${parametro.chiave.replace('.', String.raw`\.`)} .*DERIVED`, 'u'));
      }
      const { sistema, utente } = promptPerScheda(
        { ...schedaParteDiProva, tipo: { partType: famiglia.partTypes[0] ?? 'other_accessory', fonte: 'catalogo' } },
        { lingua: 'it' },
      );
      expect(tokenStimati(sistema.join('\n') + utente)).toBeLessThan(6000);
      expect(scheda).toMatchSnapshot();
    },
  );

  it('should describe only the bound family, and all of them when the type is a suggestion', () => {
    const vincolato = promptPerScheda(schedaParteDiProva, { lingua: 'it', fattoreRitaglio: 1.39 });
    expect(vincolato.famiglie).toStrictEqual(['fibbia']);
    expect(vincolato.utente).toContain('The family is FIXED: `fibbia`');
    expect(vincolato.utente).toContain(
      'Known scale: 20 mm = inner_width_mm (source: catalogo (supplier catalogue), confidence 0.9)',
    );
    expect(vincolato.utente).toContain('≈ 15.568 px/mm in picture 1');
    expect(vincolato.utente).toContain('in Italian');
    const suggerito = promptPerScheda(
      { ...schedaParteDiProva, tipo: { partType: 'buckle', fonte: 'riconosci_parti' } },
      { lingua: 'en' },
    );
    expect(suggerito.famiglie).toHaveLength(catalogoFamiglie().length);
    expect(suggerito.utente).toContain('is a suggestion');
    expect(suggerito.utente).toContain('in English');
    const senzaScala = promptPerScheda({ ...schedaParteDiProva, scala: undefined, tipo: undefined }, { lingua: 'it' });
    expect(senzaScala.utente).toContain('No known scale: estimate it');
    expect(senzaScala.utente).toContain('No declared type');
  });

  // Istantanea registrata sul codice della v2 (prima del contratto v3): senza contesto e senza viste il testo
  // dell'utente e i blocchi di sistema non cambiano di un byte, così una funzione v3 risponde come la v2 a un CAD vecchio.
  it.each([
    ['vincolata con il fattore del ritaglio', schedaParteDiProva, { lingua: 'it', fattoreRitaglio: 1.39 }],
    [
      'suggerita in inglese',
      { ...schedaParteDiProva, tipo: { partType: 'heel', fonte: 'riconosci_parti' } },
      { lingua: 'en' },
    ],
    ['senza scala né tipo', { ...schedaParteDiProva, scala: undefined, tipo: undefined }, { lingua: 'it' }],
    ['rientro', schedaParteDiProva, { lingua: 'it', fattoreRitaglio: 1.39, rientro: true }],
  ] as const)('should keep the v2 prompt byte for byte without context (%s)', (_caso, scheda, opzioni) => {
    const prompt = promptPerScheda(scheda, opzioni);
    expect(prompt.utente).toMatchSnapshot();
    expect(prompt.sistema[0]).toMatchSnapshot();
  });

  it('should number the generated views after the two pictures and the difference last, with their rules', () => {
    const contesto = {
      versione: 1,
      proporzioni: {
        rapporti: [
          { chiave: 'altezza_su_lunghezza', valore: 0.3125 },
          { chiave: 'altezza_su_altezza', valore: 0.7 },
        ],
        affidabilita: 0.8,
        parti: 4,
      },
      visibilita: { stato: 'intera', motivi: [] },
      viste: [
        { ruolo: 'controllo', faccia: 'dietro' },
        { ruolo: 'principale', faccia: 'fianco_esterno' },
      ],
    } as const;
    const v2 = promptPerScheda(schedaParteDiProva, { lingua: 'it', fattoreRitaglio: 1.39, rientro: true });
    const v3 = promptPerScheda(schedaParteDiProva, { lingua: 'it', fattoreRitaglio: 1.39, rientro: true, contesto });
    // The system blocks (and with them the prompt cache) never change.
    expect(v3.sistema).toStrictEqual(v2.sistema);
    expect(v3.utente).toContain('Picture 3: the MAIN VIEW');
    expect(v3.utente).toContain('looking straight at the face `fianco_esterno`');
    expect(v3.utente).toContain('Picture 4: the CONTROL VIEW');
    expect(v3.utente).toContain('Picture 5: the silhouette of the model');
    expect(v3.utente).toContain('`vista.*` always describes picture 1 (the photo)');
    expect(v3.utente).toContain('part height / product length = 0.313');
    expect(v3.utente).toContain('`fonte: "proporzione"`');
    expect(v3.utente).toMatchSnapshot();
    // The v2 lines are all still there, in the same order.
    const righeV3 = v3.utente.split('\n');
    expect(v2.utente.split('\n').filter((riga) => !riga.startsWith('Picture 3'))).toStrictEqual(
      righeV3.filter((riga) => v2.utente.includes(riga)),
    );
  });

  it('should say a partly visible part leaves hypotheses, and add nothing for an empty context', () => {
    const parziale = promptPerScheda(schedaParteDiProva, {
      lingua: 'en',
      contesto: { versione: 1, visibilita: { stato: 'parziale', motivi: ['tagliata_bordo', 'piccola'] } },
    });
    expect(parziale.utente).toContain(
      'The part is only partly visible in the photo (cut by the picture edge, small in the picture)',
    );
    expect(parziale.utente).not.toContain('Picture 3');
    const vuoto = promptPerScheda(schedaParteDiProva, {
      lingua: 'it',
      fattoreRitaglio: 1.39,
      contesto: { versione: 1, viste: [], proporzioni: { rapporti: [], affidabilita: 0, parti: 0 } },
    });
    expect(vuoto.utente).toBe(promptPerScheda(schedaParteDiProva, { lingua: 'it', fattoreRitaglio: 1.39 }).utente);
  });

  it('should keep the system prompt free of request data, so the cache prefix is stable', () => {
    const a = promptPerScheda(schedaParteDiProva, { lingua: 'it' });
    const b = promptPerScheda(
      { ...schedaParteDiProva, parte: { ...schedaParteDiProva.parte, etichetta: 'Altra' } },
      { lingua: 'en' },
    );
    expect(a.sistema).toStrictEqual(b.sistema);
    expect(a.sistema[0]).toContain('Output rules');
    expect(a.sistema[0]).not.toContain('tool_choice');
  });
});
