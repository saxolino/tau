import type { IdFamiglia, ParametriAnnidati, ValoreParametro } from '#famiglie/famiglia.js';
import { scriviParametro } from '#famiglie/parametri.js';
import type { LatoOccluso } from '#verifica/maschera.js';
import type { FonteScala } from '#verifica/ottimizza.js';
import type { RichiestaVerifica, RispostaVerifica } from '#verifica/verifica-funzioni.js';

/**
 * Le regole della pipeline riconoscimento → verifica → (rientro) → consegna (specifica §3.5, task T-D3-06), pure:
 * soglie, ingresso della verifica dalla scheda del classificatore, parametri consegnati con fonte e confidenza, chip.
 * La macchina a stati che le usa sta nell'app (`apps/ui/app/machines/riconoscimento.machine.ts`); la chiamata al modello
 * è D2 e vi entra come attore iniettato.
 */

/** Soglie dell'IoU sulla regione valida (§3.5). */
export const SOGLIE_VERIFICA = { accetta: 0.92, riserva: 0.85 } as const;

/** Budget della seconda verifica, dopo il rientro del modello (§3.5: 30 s). */
export const BUDGET_DOPO_RIENTRO_MS = 30_000;

/** Testo che accompagna l'immagine differenza nella seconda chiamata al classificatore (§3.5). */
export const TESTO_RIENTRO =
  'La silhouette del modello (rosso) non combacia con la maschera (blu): famiglia o variante o vista sbagliate?';

export type EsitoSoglia = 'accettato' | 'riserva' | 'rientro' | 'avviso';

/**
 * Che cosa fare con un IoU.
 * @param iou - IoU sulla regione valida dopo l'ottimizzatore.
 * @param rientriFatti - Rientri del modello già fatti (al massimo uno, §3.5).
 * @returns `accettato` (≥ 0,92), `riserva` (0,85–0,92), `rientro` (< 0,85, se non già fatto) o `avviso`.
 */
export function esitoDaIou(iou: number, rientriFatti: number): EsitoSoglia {
  if (iou >= SOGLIE_VERIFICA.accetta) {
    return 'accettato';
  }
  if (iou >= SOGLIE_VERIFICA.riserva) {
    return 'riserva';
  }
  return rientriFatti === 0 ? 'rientro' : 'avviso';
}

/** Fonti dei parametri nello schema D2 (§2.4). */
export type FonteClassificatore =
  | 'misura_nota'
  | 'taglia'
  | 'libreria'
  | 'catalogo'
  | 'proporzione'
  | 'default_mestiere'
  | 'non_visibile';

/**
 * Il sottoinsieme della scheda di riconoscimento D2 (§2.4) che la verifica usa: il punto d'aggancio di D2. Il
 * classificatore (o il suo rientro) produce questa forma; la verifica non chiede altro.
 */
export type SchedaPerVerifica = {
  famiglia: { id: IdFamiglia | 'libero' | 'non_modellabile'; confidenza: number };
  variante: { id: string; confidenza: number };
  vista: {
    azimuth: number;
    elevation: number;
    rollo: number;
    confidenza: number;
    latiOcclusi: readonly LatoOccluso[];
  };
  /** `pxPerMm` in pixel della foto (null = ignota). */
  scala: { pxPerMm: number | null; fonte: FonteScala };
  parametri: ReadonlyArray<{
    chiave: string;
    valore: ValoreParametro;
    min?: number;
    max?: number;
    confidenza: number;
    fonte: FonteClassificatore;
    motivo?: string;
  }>;
};

/**
 * La richiesta della verifica dalla scheda del classificatore e dal PNG della maschera.
 * @param scheda - Scheda di riconoscimento (D2).
 * @param png - Maschera SAM o alfa della parte.
 * @param opzioni - Opzioni dell'ottimizzatore (budget…).
 * @returns La richiesta per il worker, o null se la famiglia non si verifica (`libero`, `non_modellabile`).
 */
export function richiestaDaScheda(
  scheda: SchedaPerVerifica,
  png: Uint8Array,
  opzioni: RichiestaVerifica['opzioni'] = {},
): RichiestaVerifica | null {
  const famiglia = scheda.famiglia.id;
  if (famiglia === 'libero' || famiglia === 'non_modellabile') {
    return null;
  }
  const parametri: ParametriAnnidati = {};
  const confidenze: Record<string, number> = {};
  const intervalli: Record<string, readonly [number, number]> = {};
  const nonVisibili: string[] = [];
  for (const parametro of scheda.parametri) {
    scriviParametro(parametri, parametro.chiave, parametro.valore);
    confidenze[parametro.chiave] = parametro.confidenza;
    if (parametro.min !== undefined && parametro.max !== undefined) {
      intervalli[parametro.chiave] = [parametro.min, parametro.max];
    }
    if (parametro.fonte === 'non_visibile') {
      nonVisibili.push(parametro.chiave);
    }
  }
  return {
    famiglia,
    variante: scheda.variante.id,
    stima: { parametri, confidenze, intervalli, nonVisibili },
    vista: scheda.vista,
    scala: { pxPerMmFoto: scheda.scala.pxPerMm, fonte: scheda.scala.fonte },
    maschera: { png },
    opzioni,
  };
}

/** Un parametro consegnato, con la sua provenienza per le Misure (§2.7) e il marcatore a tre stati. */
export type ParametroConsegnato = {
  chiave: string;
  valore: ValoreParametro;
  fonte: FonteClassificatore | 'silhouette';
  confidenza: number;
  stato: 'misurata' | 'stimata' | 'ipotesi';
};

/** Una domanda da mostrare come chip (§2.6, §3.5). */
export type ChipVerifica = { codice: string; testo: string; proposte: readonly string[] };

export type Consegna = {
  esito: Exclude<EsitoSoglia, 'rientro'>;
  famiglia: IdFamiglia;
  variante?: string;
  iou: number;
  parametri: ParametroConsegnato[];
  chip: ChipVerifica[];
  /** Messaggio della card (italiano). */
  messaggio: string;
};

// Marcatore a tre stati delle Misure (§2.7): misurata per le fonti di misura e per la silhouette accettata (confidenza
// sopra 0,8, fuori dalla banda «stimata» 0,6–0,8), stimata fra 0,6 e 0,8, ipotesi sotto.
const statoDaConfidenza = (fonte: ParametroConsegnato['fonte'], confidenza: number): ParametroConsegnato['stato'] => {
  if (
    fonte === 'misura_nota' ||
    fonte === 'libreria' ||
    fonte === 'catalogo' ||
    (fonte === 'silhouette' && confidenza > 0.8)
  ) {
    return 'misurata';
  }
  return confidenza >= 0.6 ? 'stimata' : 'ipotesi';
};

const formatoIou = (iou: number): string =>
  iou.toLocaleString('it-IT', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/**
 * I parametri e i chip da consegnare (§3.5): accettato → i parametri ottimizzati prendono `fonte: silhouette` e
 * confidenza `min(0,9, IoU)`; riserva → stessi valori ma restano «stimata» (confidenza al più 0,7) e chip della vista;
 * avviso → si tiene il migliore, card «Non combacia bene» e tre chip. Gli altri parametri restano del classificatore.
 * @param scheda - Scheda del classificatore (dopo l'eventuale rientro).
 * @param risposta - Risposta della verifica (la migliore).
 * @param esito - Esito della soglia (non `rientro`).
 * @returns La consegna.
 */
export function consegnaVerifica(
  scheda: SchedaPerVerifica,
  risposta: Pick<RispostaVerifica, 'famiglia' | 'variante' | 'iou' | 'parametri' | 'chiaviOttimizzate'>,
  esito: Exclude<EsitoSoglia, 'rientro'>,
): Consegna {
  const ottimizzate = new Set(risposta.chiaviOttimizzate);
  const leggi = (chiave: string): ValoreParametro | undefined => {
    let corrente: unknown = risposta.parametri;
    for (const segmento of chiave.split('.')) {
      corrente = (corrente as Record<string, unknown> | undefined)?.[segmento];
    }
    return corrente as ValoreParametro | undefined;
  };
  const confidenzaSilhouette = esito === 'accettato' ? Math.min(0.9, risposta.iou) : Math.min(0.7, risposta.iou);
  const parametri: ParametroConsegnato[] = scheda.parametri.map((parametro) => {
    if (ottimizzate.has(parametro.chiave) && esito !== 'avviso') {
      return {
        chiave: parametro.chiave,
        valore: leggi(parametro.chiave) ?? parametro.valore,
        fonte: 'silhouette',
        confidenza: confidenzaSilhouette,
        stato: esito === 'accettato' ? statoDaConfidenza('silhouette', confidenzaSilhouette) : 'stimata',
      };
    }
    // Con l'avviso si tiene il migliore trovato, ma la fonte resta del classificatore: non è una misura.
    const valore = esito === 'avviso' ? (leggi(parametro.chiave) ?? parametro.valore) : parametro.valore;
    return {
      chiave: parametro.chiave,
      valore,
      fonte: parametro.fonte,
      confidenza: parametro.confidenza,
      stato: statoDaConfidenza(parametro.fonte, parametro.confidenza),
    };
  });
  const chip: ChipVerifica[] = [];
  let messaggio = `Combacia con la foto (IoU ${formatoIou(risposta.iou)}).`;
  if (esito === 'riserva') {
    chip.push({ codice: 'VISTA', testo: 'Controlla la vista', proposte: ['fianco', '3/4', 'dietro'] });
    messaggio = `Combacia quasi (IoU ${formatoIou(risposta.iou)}): le misure restano stimate.`;
  } else if (esito === 'avviso') {
    chip.push(
      { codice: 'TIPO', testo: 'Scegli il tipo', proposte: [] },
      { codice: 'FOTO', testo: 'Aggiungi una foto', proposte: [] },
      { codice: 'LIBERO', testo: 'Costruisci come pezzo libero', proposte: [] },
    );
    messaggio = `Non combacia bene (IoU ${formatoIou(risposta.iou)}).`;
  }
  return {
    esito,
    famiglia: risposta.famiglia,
    ...(risposta.variante === undefined ? {} : { variante: risposta.variante }),
    iou: risposta.iou,
    parametri,
    chip,
    messaggio,
  };
}
