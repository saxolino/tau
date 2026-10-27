/**
 * Le soglie del riconoscimento (specifica D2 §2.6 e D3 §3.5): quando si chiede all'utente e come si marca un valore.
 */

/** Soglie del riconoscimento. @public */
export const soglie = {
  /** Sotto: chip della famiglia PRIMA di costruire. */
  famiglia: 0.6,
  /** Sotto, per un parametro critico: chip con tre valori. */
  critico: 0.6,
  /** Sotto, per un parametro non critico: nessuna domanda, solo la riga «Ipotesi: controlla». */
  nonCritico: 0.8,
  /** Domande per riconoscimento, una alla volta. */
  domandeMassime: 3,
  /** IoU della verifica D3 sopra cui il riconoscimento è accettato. */
  iouAccettato: 0.92,
  /** IoU sotto cui si rientra nel modello (una volta). */
  iouRiserva: 0.85,
  /** Confidenza della scala sotto cui ogni misura in mm è un'ipotesi (fonte `stima`). */
  scalaStimata: 0.5,
} as const;

/** Le fonti che contano come misura dichiarata, non come stima. */
const fontiMisurate: ReadonlySet<string> = new Set(['misura_nota', 'libreria', 'catalogo']);

/**
 * Lo stato di un valore riconosciuto nelle Misure (§2.7): `misurata` (dichiarata o molto sicura, nessun simbolo),
 * `stimata` (◐, confidenza 0,6–0,8) o `ipotesi` (○, sotto 0,6). Con la scala stimata ogni misura in mm è un'ipotesi.
 * @param valore - Confidenza e fonte del parametro.
 * @param contesto - Se la scala è stimata e l'unità del parametro.
 * @returns Lo stato.
 * @public
 */
export function statoValore(
  valore: Readonly<{ confidenza: number; fonte: string }>,
  contesto: Readonly<{ scalaStimata?: boolean; unita?: string }> = {},
): 'misurata' | 'stimata' | 'ipotesi' {
  if (valore.fonte === 'non_visibile' || valore.confidenza < soglie.critico) {
    return 'ipotesi';
  }
  if (contesto.scalaStimata && contesto.unita === 'mm' && !fontiMisurate.has(valore.fonte)) {
    return 'ipotesi';
  }
  if (fontiMisurate.has(valore.fonte) || valore.confidenza >= soglie.nonCritico) {
    return 'misurata';
  }
  return 'stimata';
}
