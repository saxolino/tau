import type { ParametriAnnidati } from '#famiglie/famiglia.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';

/**
 * Il punto di aggancio della verifica numerica D3 (silhouette ↔ maschera, specifica §3): il riconoscimento la chiama
 * dopo aver costruito il pezzo e dopo ogni risposta a un chip. L'implementazione (render nel worker del kernel, IoU,
 * Nelder–Mead) arriva dal ramo della verifica e si registra con {@link registraVerificaSilhouette}; finché non c'è, la
 * verifica risponde «non disponibile» e il riconoscimento consegna senza IoU.
 */

/** Ciò che la verifica riceve. @public */
export type RichiestaVerifica = Readonly<{
  famiglia: string;
  variante: string;
  parametri: ParametriAnnidati;
  /** Le chiavi fissate dall'utente: l'ottimizzatore non le muove. */
  bloccati: readonly string[];
  vista: SchedaRiconoscimento['vista'];
  scala: SchedaRiconoscimento['scala'];
  /** La maschera della parte (PNG, bianco = parte) e il suo riquadro nell'immagine originale. */
  maschera: Readonly<{ png: Uint8Array<ArrayBuffer>; larghezzaPx: number; altezzaPx: number }>;
  /** Stime e bande del classificatore, per il prior dell'obiettivo (§3.3). */
  stime: SchedaRiconoscimento['parametri'];
  segnale?: AbortSignal;
}>;

/** L'esito della verifica. @public */
export type EsitoVerifica =
  | Readonly<{ disponibile: false; motivo: 'modulo_assente' | 'errore'; dettaglio?: string }>
  | Readonly<{
      disponibile: true;
      iou: number;
      /** Parametri dopo l'ottimizzazione (solo quelli `silhouetteSensibile` cambiano). */
      parametri: ParametriAnnidati;
      camera: Readonly<{ azimuth: number; elevation: number; rollo: number; pxPerMm: number; cx: number; cy: number }>;
      valutazioni: number;
      millisecondi: number;
      /** Immagine differenza 256² (PNG): rosso dove manca la maschera, blu dove manca il modello. */
      differenza?: Uint8Array<ArrayBuffer>;
    }>;

/** Una implementazione della verifica. @public */
export type VerificatoreSilhouette = (richiesta: RichiestaVerifica) => Promise<EsitoVerifica>;

let verificatore: VerificatoreSilhouette | undefined;

/**
 * Registra l'implementazione della verifica (la chiama il modulo D3 quando è caricato).
 * @param implementazione - La verifica, o undefined per toglierla.
 * @public
 */
export function registraVerificaSilhouette(implementazione: VerificatoreSilhouette | undefined): void {
  verificatore = implementazione;
}

/**
 * Verifica la silhouette del pezzo contro la maschera. Senza modulo D3 risponde subito «non disponibile»; un errore
 * della verifica non rompe mai il riconoscimento.
 * @param richiesta - Pezzo, vista, scala e maschera.
 * @returns L'esito.
 * @public
 */
export async function verificaSilhouette(richiesta: RichiestaVerifica): Promise<EsitoVerifica> {
  if (verificatore === undefined) {
    return { disponibile: false, motivo: 'modulo_assente' };
  }
  try {
    return await verificatore(richiesta);
  } catch (error) {
    return { disponibile: false, motivo: 'errore', dettaglio: error instanceof Error ? error.message : String(error) };
  }
}
