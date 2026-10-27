// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { nelderMead } from '#verifica/nelder-mead.js';

/** Rosenbrock on [−2, 2]², through variables normalised to [0, 1]. */
const daUnitario = (u: number): number => -2 + 4 * u;
const aUnitario = (x: number): number => (x + 2) / 4;
const rosenbrock = (u: readonly number[]): number => {
  const [x, y] = [daUnitario(u[0]!), daUnitario(u[1]!)];
  return (1 - x) ** 2 + 100 * (y - x * x) ** 2;
};

describe('Nelder–Mead con limiti', () => {
  it('should reach the Rosenbrock minimum from (−1.2, 1) in fewer than 200 evaluations', () => {
    const risultato = nelderMead(rosenbrock, [aUnitario(-1.2), aUnitario(1)], {
      passo: 0.1,
      valutazioniMassime: 200,
      tolleranzaF: 1e-12,
      tolleranzaX: 1e-6,
    });
    expect(risultato.valutazioni).toBeLessThan(200);
    expect(risultato.motivo).toBe('convergenza');
    expect(Math.abs(daUnitario(risultato.x[0]!) - 1)).toBeLessThan(1e-3);
    expect(Math.abs(daUnitario(risultato.x[1]!) - 1)).toBeLessThan(2e-3);
    expect(risultato.f).toBeLessThan(1e-6);
  });

  it('should stay inside [0, 1] and stop on the bound when the minimum lies beyond it', () => {
    const visti: number[][] = [];
    const risultato = nelderMead(
      (x) => {
        visti.push([...x]);
        return (x[0]! - 1.5) ** 2 + (x[1]! + 0.3) ** 2;
      },
      [0.5, 0.5],
      { valutazioniMassime: 150 },
    );
    expect(visti.flat().every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(risultato.x[0]).toBeCloseTo(1, 6);
    expect(risultato.x[1]).toBeCloseTo(0, 6);
  });

  it('should converge on an 8-variable quadratic with the adaptive coefficients', () => {
    const centro = [0.2, 0.8, 0.35, 0.5, 0.65, 0.1, 0.9, 0.45];
    const pesi = [1, 3, 0.5, 2, 1, 4, 0.7, 1.5];
    const risultato = nelderMead(
      (x) => x.reduce((somma, v, i) => somma + pesi[i]! * (v - centro[i]!) ** 2, 0),
      Array.from({ length: 8 }, () => 0.5),
      { valutazioniMassime: 3000, tolleranzaF: 1e-14, tolleranzaX: 1e-7 },
    );
    expect(risultato.motivo).toBe('convergenza');
    for (const [i, v] of risultato.x.entries()) {
      expect(v).toBeCloseTo(centro[i]!, 3);
    }
  });

  it('should stop when the caller says so or when the evaluations run out, keeping the best point', () => {
    const anticipato = nelderMead(rosenbrock, [0.2, 0.7], {
      valutazioniMassime: 500,
      arresto: ({ fMigliore }) => fMigliore < 1,
    });
    expect(anticipato.motivo).toBe('arresto');
    expect(anticipato.f).toBeLessThan(1);
    const esaurito = nelderMead(rosenbrock, [0.2, 0.7], { valutazioniMassime: 7 });
    expect(esaurito.motivo).toBe('valutazioni');
    expect(esaurito.valutazioni).toBe(7);
    expect(esaurito.f).toBe(Math.min(esaurito.f, rosenbrock([0.2, 0.7])));
  });
});
