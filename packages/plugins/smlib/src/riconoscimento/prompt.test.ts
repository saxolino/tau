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
