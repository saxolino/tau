/* eslint-disable @typescript-eslint/naming-convention -- chiavi dei dati della specifica (processi, materiali, varianti, taglie): snake_case come in Sinopia. */
/**
 * Taglie degli anelli (specifica §1.7): dal sistema e dal valore al diametro interno in millimetri.
 *
 * - Italia: circonferenza interna = taglia + 40 mm (IT 14 → 54 mm → ⌀ 17,19).
 * - ISO 8653 («EU/ISO»): la taglia è la circonferenza interna in mm (ISO 54 → ⌀ 17,19).
 * - USA/Canada: ⌀ = 11,63 + 0,8128 × taglia (tabella usuale: US 7 → ⌀ 17,32, circonferenza 54,4). La formula della
 *   specifica (circonferenza = 2,5296 × taglia + 36,54) dà 17,27 per US 7 contro i 17,35 del suo stesso test: si usa
 *   quella della tabella, che sta entro 0,05 mm dai valori pubblicati da US 3 a US 15.
 * - `diametro`: il valore è già il diametro interno.
 *
 * Fonti (le formule di questo file le riproducono, i test le confrontano con i valori pubblicati):
 * - ISO 8653:2016 «Jewellery — Ring-sizes — Definitions, measurement and designation»: la taglia ISO è la
 *   circonferenza interna in mm (tabella: ISO 44 → ⌀ 14,0 · ISO 54 → ⌀ 17,2 · ISO 62 → ⌀ 19,7).
 * - Italia: la misura è la circonferenza interna meno 40 mm (tabella dei gioiellieri: IT 14 = ⌀ 17,2 mm).
 * - USA/Canada: tabella di Jewelers of America; 0,032 in (0,8128 mm) di diametro per taglia, US 7 = ⌀ 17,3 mm,
 *   US 10 = ⌀ 19,8 mm. Una taglia US intera non coincide mai con una ISO intera: la conversione è la più vicina.
 * @public
 */
export type SistemaTaglia = 'it' | 'us' | 'eu_iso' | 'diametro';

/**
 * Intervallo ammesso per sistema.
 * @public
 */
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
 * @public
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
 * @public
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

/**
 * Passo con cui si sceglie la taglia in un sistema: gli interi, i mezzi numeri per gli USA, il decimo di mm per il
 * diametro.
 * @public
 */
export const passoTaglia: Readonly<Record<SistemaTaglia, number>> = { it: 1, us: 0.5, eu_iso: 1, diametro: 0.5 };

/**
 * Nome breve del sistema, come lo scrive la bottega.
 * @public
 */
export const nomeSistemaTaglia: Readonly<Record<SistemaTaglia, string>> = {
  it: 'IT',
  us: 'US',
  eu_iso: 'EU',
  diametro: '⌀',
};

/**
 * Una taglia letta in tutti i sistemi: il diametro e la circonferenza interna sono quelli veri, le altre taglie le
 * più vicine (gli USA a mezzi numeri).
 * @public
 */
export type RigaTaglia = Readonly<{
  sistema: SistemaTaglia;
  valore: number;
  /** Diametro interno (mm). */
  diametro: number;
  /** Circonferenza interna (mm). */
  circonferenza: number;
  it: number;
  eu_iso: number;
  us: number;
}>;

/**
 * La taglia in tutti i sistemi.
 * @param sistema - Sistema della taglia data.
 * @param valore - Taglia.
 * @returns Diametro, circonferenza e la stessa taglia negli altri sistemi.
 * @public
 */
export function rigaTaglia(sistema: SistemaTaglia, valore: number): RigaTaglia {
  const diametro = diametroInterno(sistema, valore);
  return {
    sistema,
    valore,
    diametro,
    circonferenza: diametro * Math.PI,
    it: tagliaDaDiametro('it', diametro),
    eu_iso: tagliaDaDiametro('eu_iso', diametro),
    us: tagliaDaDiametro('us', diametro),
  };
}

/**
 * Le taglie ammesse di un sistema, dalla più piccola alla più grande, ciascuna letta in tutti i sistemi.
 * @param sistema - Sistema di taglie.
 * @returns Una riga per taglia, secondo `intervalliTaglia` e `passoTaglia`.
 * @public
 */
export function tabellaTaglie(sistema: SistemaTaglia): readonly RigaTaglia[] {
  const [minimo, massimo] = intervalliTaglia[sistema];
  const passo = passoTaglia[sistema];
  const righe: RigaTaglia[] = [];
  for (let indice = 0; minimo + indice * passo <= massimo + 1e-9; indice++) {
    righe.push(rigaTaglia(sistema, Math.round((minimo + indice * passo) * 100) / 100));
  }
  return righe;
}
