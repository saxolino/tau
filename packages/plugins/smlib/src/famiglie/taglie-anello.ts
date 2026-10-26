/**
 * Taglie degli anelli (specifica §1.7): dal sistema e dal valore al diametro interno in millimetri.
 *
 * - Italia: circonferenza interna = taglia + 40 mm (IT 14 → 54 mm → ⌀ 17,19).
 * - ISO 8653 («EU/ISO»): la taglia è la circonferenza interna in mm (ISO 54 → ⌀ 17,19).
 * - USA/Canada: ⌀ = 11,63 + 0,8128 × taglia (tabella usuale: US 7 → ⌀ 17,32, circonferenza 54,4). La formula della
 *   specifica (circonferenza = 2,5296 × taglia + 36,54) dà 17,27 per US 7 contro i 17,35 del suo stesso test: si usa
 *   quella della tabella, che sta entro 0,05 mm dai valori pubblicati da US 3 a US 15.
 * - `diametro`: il valore è già il diametro interno.
 */
export type SistemaTaglia = 'it' | 'us' | 'eu_iso' | 'diametro';

/** Intervallo ammesso per sistema. */
export const intervalliTaglia: Readonly<Record<SistemaTaglia, readonly [number, number]>> = {
  it: [1, 35],
  us: [3, 15],
  eu_iso: [41, 76],
  diametro: [13, 24],
};

/**
 * Diametro interno in mm di una taglia.
 * @param sistema - Sistema di taglie.
 * @param valore - Taglia (US anche a mezzi numeri).
 * @returns Millimetri.
 */
export function diametroInterno(sistema: SistemaTaglia, valore: number): number {
  switch (sistema) {
    case 'it': {
      return (valore + 40) / Math.PI;
    }
    case 'eu_iso': {
      return valore / Math.PI;
    }
    case 'us': {
      return 11.63 + 0.8128 * valore;
    }
    default: {
      return valore;
    }
  }
}

/**
 * La taglia di un sistema più vicina a un diametro interno (arrotondata a 1, o a 0,5 per gli USA).
 * @param sistema - Sistema di taglie.
 * @param diametro - Diametro interno in mm.
 * @returns La taglia.
 */
export function tagliaDaDiametro(sistema: SistemaTaglia, diametro: number): number {
  switch (sistema) {
    case 'it': {
      return Math.round(diametro * Math.PI - 40);
    }
    case 'eu_iso': {
      return Math.round(diametro * Math.PI);
    }
    case 'us': {
      return Math.round(((diametro - 11.63) / 0.8128) * 2) / 2;
    }
    default: {
      return Math.round(diametro * 10) / 10;
    }
  }
}
