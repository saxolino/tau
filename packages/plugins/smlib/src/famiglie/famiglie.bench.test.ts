// @vitest-environment node
import { cpus, loadavg } from 'node:os';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as Smlib from '@classcad/smlibwasm';
import { famiglie } from '#famiglie/registro.js';
import type { FamigliaQualsiasi } from '#famiglie/famiglia.js';

/**
 * T-D1-12: ogni famiglia con i predefiniti (la sua prima variante) si ricostruisce entro 300 ms, il budget che rende
 * possibile l'ottimizzatore di D3; in CI la soglia raddoppia. Le altre varianti si misurano e si stampano: quelle
 * ovali (fibbia, placca) superano il budget perché `extrude` sformato e raccordi su pareti ellittiche B-spline costano
 * centinaia di millisecondi nel kernel. Si misura il migliore di tre costruzioni dopo un giro a vuoto.
 */
let lib: typeof Smlib;
beforeAll(async () => {
  lib = await import('@classcad/smlibwasm');
});

const carico = loadavg()[0]! / cpus().length;
// Doppia in CI e con la macchina carica (altri processi in corso): i tempi del kernel crescono col carico.
const soglia = 300 * (process.env['CI'] ? 2 : 1) * (carico > 0.8 ? 2 : 1);

const casi = Object.values(famiglie).flatMap((famiglia: FamigliaQualsiasi) =>
  famiglia.varianti.map((variante, indice) => [famiglia.id, variante, famiglia, indice === 0] as const),
);

describe('tempo di ricostruzione delle famiglie', () => {
  const tempi: string[] = [];

  it.each(casi)('should rebuild %s (%s) and time it', (_id, variante, famiglia, predefinita) => {
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
    if (predefinita) {
      expect(migliore).toBeLessThan(soglia);
    }
  });

  it('should print the timing table', () => {
    // oxlint-disable-next-line no-console -- the benchmark table is the deliverable of T-D1-12.
    console.log(
      `Tempi di ricostruzione (migliore di 3, dopo un giro a vuoto; carico ${carico.toFixed(2)} per core, soglia ${soglia} ms):\n${tempi.join('\n')}`,
    );
    expect(tempi.length).toBe(casi.length);
  });
});
