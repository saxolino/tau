/**
 * Sonda dei tempi per pezzo (solo per il banco di prova `ricostruzione.bench.test.ts`). Spenta di default: con
 * `attiva = false` `misuraPezzo` chiama la funzione e basta, senza cronometro né memoria.
 * @internal
 */
export const sondaTempi: { attiva: boolean; voci: Array<{ pezzo: string; ms: number }> } = {
  attiva: false,
  voci: [],
};

/**
 * Esegue `costruzione` e, se la sonda è accesa, ne registra la durata sotto il nome del pezzo.
 * @param pezzo - Nome del pezzo costruito.
 * @param costruzione - La costruzione geometrica del pezzo.
 * @returns Il risultato della costruzione.
 * @internal
 */
export function misuraPezzo<T>(pezzo: string, costruzione: () => T): T {
  if (!sondaTempi.attiva) {
    return costruzione();
  }
  const inizio = performance.now();
  try {
    return costruzione();
  } finally {
    sondaTempi.voci.push({ pezzo, ms: performance.now() - inizio });
  }
}
