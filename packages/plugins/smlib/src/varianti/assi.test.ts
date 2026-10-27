// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FamigliaQualsiasi, ParametriAnnidati } from '#famiglie/famiglia.js';
import { fibbia } from '#famiglie/fibbia.js';
import { leggiParametro } from '#famiglie/parametri.js';
import { famiglie } from '#famiglie/registro.js';
import {
  attenuaProposta,
  chiaviMobili,
  differenzeParametri,
  insiemeAgente,
  normalizzati,
  proponiVarianti,
} from '#varianti/assi.js';

/** Every family of the registry, as `[id, family]` rows for `it.each`. */
const tutteLeFamiglie = Object.entries(famiglie).map(([id, famiglia]) => [id, famiglia] as [string, FamigliaQualsiasi]);

const valore = (p: unknown, chiave: string): number => leggiParametro(p, chiave) as number;

/** Every numeric leaf of the family's definitions is inside its declared limits. */
const dentroILimiti = (famiglia: FamigliaQualsiasi, p: ParametriAnnidati): boolean =>
  famiglia.parametri.every((definizione) => {
    if (definizione.derivato) {
      return true;
    }
    const v = leggiParametro(p, definizione.chiave);
    if (typeof v !== 'number') {
      return true;
    }
    return (
      (definizione.min === undefined || v >= definizione.min - 1e-9) &&
      (definizione.max === undefined || v <= definizione.max + 1e-9)
    );
  });

describe('proponiVarianti', () => {
  it('should propose a slender, a sturdy and a minimal buckle from the defaults, the same every time', () => {
    const p = fibbia.predefiniti('rettangolare');
    const prime = proponiVarianti(fibbia, p, { variante: 'rettangolare' });
    const seconde = proponiVarianti(fibbia, p, { variante: 'rettangolare' });
    expect(prime.map((proposta) => proposta.asse)).toEqual(['slanciata', 'robusta', 'minimale']);
    expect(seconde).toEqual(prime);
    const [slanciata, robusta, minimale] = prime;
    expect(valore(slanciata!.parametri, 'telaio.sezioneLarghezza')).toBeLessThan(p.telaio.sezioneLarghezza);
    expect(valore(robusta!.parametri, 'telaio.sezioneLarghezza')).toBeGreaterThan(p.telaio.sezioneLarghezza);
    expect(leggiParametro(minimale!.parametri, 'telaio.profilo')).toBe('piatto');
    // Values land on the parameter's step, not on binary noise.
    expect(valore(slanciata!.parametri, 'telaio.sezioneLarghezza')).toBe(2.4);
  });

  it('should keep the function: the strap width (critical) never moves, so the strap still fits', () => {
    const p = fibbia.predefiniti();
    for (const proposta of proponiVarianti(fibbia, p)) {
      expect(valore(proposta.parametri, 'cinturino.larghezza')).toBe(p.cinturino.larghezza);
      expect(proposta.differenze.some((differenza) => differenza.chiave === 'telaio.luce')).toBe(false);
    }
  });

  it('should never change a value the designer fixed, and drop an axis left with nothing to move', () => {
    const p = fibbia.predefiniti();
    const bloccati = [
      'telaio.sezioneLarghezza',
      'telaio.sezioneSpessore',
      'ardiglione.diametro',
      'telaio.raggioAngoli',
    ];
    const proposte = proponiVarianti(fibbia, p, { bloccati: [...bloccati, 'telaio.altezzaInterna'] });
    for (const proposta of proposte) {
      for (const chiave of bloccati) {
        expect(leggiParametro(proposta.parametri, chiave)).toEqual(leggiParametro(p, chiave));
      }
    }
    // Slender and sturdy only move locked keys; the minimal one still changes the profile.
    expect(proposte.map((proposta) => proposta.asse)).toEqual(['minimale']);
  });

  it('should list what changes, the largest relative change first, with derived measures that follow', () => {
    const p = fibbia.predefiniti();
    const [slanciata] = proponiVarianti(fibbia, p, { assi: ['slanciata'] });
    const variazioni = slanciata!.differenze.flatMap((differenza) =>
      differenza.variazione === undefined ? [] : [Math.abs(differenza.variazione)],
    );
    expect(variazioni).toEqual(variazioni.toSorted((a, b) => b - a));
    // The pin's length is derived from the opening and the section: it follows them.
    expect(slanciata!.differenze.some((differenza) => differenza.chiave === 'ardiglione.lunghezza')).toBe(true);
  });

  it.each(tutteLeFamiglie)(
    'should keep every %s variant inside the limits and the constraints, critical values untouched',
    (_id, famiglia) => {
      for (const variante of famiglia.varianti) {
        const p: unknown = famiglia.predefiniti(variante);
        const base = normalizzati(famiglia, p, variante);
        const proposte = proponiVarianti(famiglia, p, { variante });
        expect(proposte.length).toBeGreaterThanOrEqual(2);
        expect(proponiVarianti(famiglia, p, { variante })).toEqual(proposte);
        for (const proposta of proposte) {
          expect(dentroILimiti(famiglia, proposta.parametri)).toBe(true);
          expect(famiglia.vincoli(proposta.parametri).length).toBeLessThanOrEqual(famiglia.vincoli(base).length);
          for (const definizione of famiglia.parametri.filter((voce) => voce.critico === true)) {
            expect(leggiParametro(proposta.parametri, definizione.chiave)).toEqual(
              leggiParametro(base, definizione.chiave),
            );
          }
          expect(proposta.differenze.length).toBeGreaterThan(0);
        }
      }
    },
  );
});

describe('chiaviMobili', () => {
  it('should leave out derived, critical, free-text and fixed parameters', () => {
    const mobili = chiaviMobili(fibbia, ['telaio.profilo']);
    expect(mobili.has('telaio.sezioneLarghezza')).toBe(true);
    expect(mobili.has('cinturino.larghezza')).toBe(false);
    expect(mobili.has('telaio.luce')).toBe(false);
    expect(mobili.has('telaio.profilo')).toBe(false);
  });
});

describe('attenuaProposta', () => {
  it('should bring a variant halfway back towards the current values', () => {
    const p = fibbia.predefiniti();
    const [robusta] = proponiVarianti(fibbia, p, { assi: ['robusta'] });
    const meta = attenuaProposta(fibbia, { attuali: p, proposta: robusta!, frazione: 0.5 });
    const prima = p.telaio.sezioneLarghezza;
    const dopo = valore(robusta!.parametri, 'telaio.sezioneLarghezza');
    expect(valore(meta.parametri, 'telaio.sezioneLarghezza')).toBeCloseTo(prima + (dopo - prima) / 2, 1);
    expect(meta.id).toBe(robusta!.id);
  });
});

describe('insiemeAgente', () => {
  it('should take the agent’s values inside the limits, skipping unknown, derived and fixed keys', () => {
    const p = fibbia.predefiniti();
    const proposta = insiemeAgente(fibbia, {
      id: 'agente-1',
      attuali: p,
      bloccati: ['telaio.profilo'],
      insieme: {
        titolo: 'Fibbia importante',
        motivo: 'Sezione piena per un cinturino da 40.',
        parametri: {
          cinturino: { larghezza: 40 },
          telaio: { sezioneLarghezza: 99, luce: 3, inventato: 2, profilo: 'piatto' },
        },
      },
    });
    expect(proposta?.origine).toBe('agente');
    expect(proposta?.titolo).toBe('Fibbia importante');
    expect(valore(proposta!.parametri, 'cinturino.larghezza')).toBe(40);
    expect(valore(proposta!.parametri, 'telaio.sezioneLarghezza')).toBe(8);
    expect(leggiParametro(proposta!.parametri, 'telaio.profilo')).toBe(p.telaio.profilo);
    expect(leggiParametro(proposta!.parametri, 'telaio.inventato')).toBeUndefined();
  });

  it('should give nothing when the agent’s set changes nothing', () => {
    const p = fibbia.predefiniti();
    expect(
      insiemeAgente(fibbia, { id: 'x', attuali: p, insieme: { parametri: { telaio: { profilo: p.telaio.profilo } } } }),
    ).toBeUndefined();
  });
});

describe('differenzeParametri', () => {
  it('should be empty between equal sets', () => {
    const p = fibbia.predefiniti();
    expect(differenzeParametri(fibbia, p, structuredClone(p))).toEqual([]);
  });
});
