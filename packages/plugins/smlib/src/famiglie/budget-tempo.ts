/* oxlint-disable new-cap -- SMLib exposes capitalized shape factory functions. */
import type * as Smlib from '@classcad/smlibwasm';

/** Budget di ricostruzione di una famiglia (T-D1-12), in millisecondi su un M-series libero. */
export const BUDGET_RICOSTRUZIONE = 300;

/** Tempo di riferimento della prova di taratura su un M-series libero (ms). */
const RIFERIMENTO = 48;

/**
 * Il budget di ricostruzione tarato sulla macchina di adesso: una prova fissa (raccordo, foro, rilettura SMB di un
 * cubo) misura quanto il kernel è rallentato da altri processi o da file di test in parallelo, e il budget cresce
 * nella stessa proporzione (mai sotto i 300 ms; doppio in CI). Serve ai test dei tempi, non alle ricette.
 * @param lib - Libreria SMLib.
 * @returns Millisecondi.
 */
export function budgetTarato(lib: typeof Smlib): number {
  const prova = (): unknown => {
    const cubo = lib.Box(20, 20, 20);
    return lib.fromSmb(lib.toSmb(cubo.fillet(cubo.edges(), 2).cut(lib.Cylinder(4, 30)), { ascii: false }));
  };
  prova();
  let migliore = Number.POSITIVE_INFINITY;
  for (let giro = 0; giro < 3; giro++) {
    const inizio = performance.now();
    prova();
    migliore = Math.min(migliore, performance.now() - inizio);
  }
  return BUDGET_RICOSTRUZIONE * (process.env['CI'] ? 2 : 1) * Math.max(1, migliore / RIFERIMENTO);
}
