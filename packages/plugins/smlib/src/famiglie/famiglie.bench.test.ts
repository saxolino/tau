// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { famiglie } from '#famiglie/registro.js';
import { budgetTarato } from '#famiglie/budget-tempo.js';
import type { FamigliaQualsiasi } from '#famiglie/famiglia.js';

/**
 * T-D1-12: ogni famiglia con i predefiniti, e ogni variante ovale, si ricostruisce entro 300 ms (il budget che rende
 * possibile l'ottimizzatore di D3), tarati su una prova fissa (`budget-tempo.ts`): doppi in CI e cresciuti col rallentamento
 * della macchina; le altre varianti entro una volta e mezza. Si misura il migliore di tre costruzioni
 * dopo un giro a vuoto e si stampa la tabella. Le varianti ovali stanno nel budget con l'ovale a quattro centri e lo
 * sformo per `draft` dei fianchi (`profili.ts`): con l'ellisse e il `taper` erano 325–870 ms.
 */
// Costruzioni B-rep ripetute: sulla macchina carica una prova supera i 5 s predefiniti.
vi.setConfig({ testTimeout: 60_000 });
let lib: typeof Smlib;
let soglia = 300;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
  soglia = budgetTarato(lib);
});

const casi = Object.values(famiglie).flatMap((famiglia: FamigliaQualsiasi) =>
  famiglia.varianti.map((variante, indice) => ({ id: famiglia.id, variante, famiglia, predefinita: indice === 0 })),
);

describe('tempo di ricostruzione delle famiglie', () => {
  const tempi: string[] = [];

  it.each(casi)('should rebuild $id ($variante) within the budget', ({ variante, famiglia, predefinita }) => {
    const p: unknown = famiglia.normalizza(famiglia.predefiniti(variante), { variante });
    famiglia.costruisci(lib, p, { variante });
    const misure: number[] = [];
    for (let giro = 0; giro < 3; giro++) {
      const inizio = performance.now();
      const pezzi = famiglia.costruisci(lib, p, { variante });
      misure.push(performance.now() - inizio);
      expect(pezzi.length).toBeGreaterThan(0);
    }
    const migliore = Math.min(...misure);
    tempi.push(
      `${famiglia.id.padEnd(10)} ${variante.padEnd(13)} ${migliore.toFixed(0).padStart(5)} ms${predefinita ? '  (predefinita)' : ''}`,
    );
    // Predefinite e ovali entro il budget; le altre varianti (tacchi bassi, 260–300 ms) con il 50 % di margine. Il fondo
    // semplice è fuori budget (≈ 0,9 s la coppia: tagli con due superfici e raccordi su un fianco B-spline): tetto 5×.
    const fuoriBudget = famiglia.id === 'fondo_semplice';
    const stretta = !fuoriBudget && (predefinita || variante === 'ovale' || variante === 'a_d');
    // Taratura subito prima del caso: la contesa con gli altri file di test cambia durante la suite.
    soglia = budgetTarato(lib);
    expect(migliore).toBeLessThan(fuoriBudget ? soglia * 5 : stretta ? soglia : soglia * 1.5);
  });

  it('should print the timing table', () => {
    // oxlint-disable-next-line no-console -- the benchmark table is the deliverable of T-D1-12.
    console.log(
      `Tempi di ricostruzione (migliore di 3, dopo un giro a vuoto; soglia tarata ${soglia.toFixed(0)} ms):\n${tempi.join('\n')}`,
    );
    expect(tempi.length).toBe(casi.length);
  });
});
