import type { IdFamiglia, ParametriAnnidati, ValoreParametro } from '#famiglie/famiglia.js';
import { scriviParametro } from '#famiglie/parametri.js';
import { famiglie } from '#famiglie/registro.js';
import type { LatoOccluso } from '#verifica/maschera.js';
import type { FonteScala } from '#verifica/ottimizza.js';
import { parametriSensibili } from '#verifica/ottimizza.js';
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

/** Le fonti che sono una misura dichiarata: la verifica non le muove (§2.5). */
const FONTI_DICHIARATE: ReadonlySet<string> = new Set(['misura_nota', 'libreria', 'catalogo']);

/**
 * La richiesta della verifica dalla scheda del classificatore e dal PNG della maschera.
 * @param scheda - Scheda di riconoscimento (D2).
 * @param png - Maschera SAM o alfa della parte.
 * @param opzioni - Opzioni dell'ottimizzatore (budget…).
 * @param bloccati - Chiavi che l'ottimizzatore non muove (valori fissati dall'utente). Non si muovono mai nemmeno le
 *   misure dichiarate (`misura_nota`, `libreria`, `catalogo`): sono la scala stessa della foto, non ipotesi.
 * @returns La richiesta per il worker, o null se la famiglia non si verifica (`libero`, `non_modellabile`).
 */
export function richiestaDaScheda(
  scheda: SchedaPerVerifica,
  png: Uint8Array,
  opzioni: RichiestaVerifica['opzioni'] = {},
  bloccati: readonly string[] = [],
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
  const dichiarati = new Set(scheda.parametri.filter((p) => FONTI_DICHIARATE.has(p.fonte)).map((p) => p.chiave));
  const fermi = new Set([...bloccati, ...dichiarati]);
  const chiavi = parametriSensibili(famiglie[famiglia]!)
    .map((definizione) => definizione.chiave)
    .filter((chiave) => !fermi.has(chiave));
  return {
    famiglia,
    variante: scheda.variante.id,
    stima: { parametri, confidenze, intervalli, nonVisibili },
    vista: scheda.vista,
    scala: { pxPerMmFoto: scheda.scala.pxPerMm, fonte: scheda.scala.fonte },
    maschera: { png },
    opzioni: { ...(fermi.size > 0 ? { chiavi } : {}), ...opzioni },
  };
}

/** Un parametro consegnato, con la sua provenienza per le Misure (§2.7) e il marcatore a tre stati. */
export type ParametroConsegnato = {
  chiave: string;
  valore: ValoreParametro;
  fonte: FonteClassificatore | 'silhouette';
  confidenza: number;
  stato: 'misurata' | 'stimata' | 'ipotesi';
  /** Banda dei valori plausibili (del classificatore, o quelli che la vista non distingue). */
  min?: number;
  max?: number;
};

/** Una domanda da mostrare come chip (§2.6, §3.5). */
export type ChipVerifica = { codice: string; testo: string; proposte: readonly string[] };

export type Consegna = {
  esito: Exclude<EsitoSoglia, 'rientro'>;
  famiglia: IdFamiglia;
  variante?: string;
  iou: number;
  parametri: ParametroConsegnato[];
  /** Parametri mossi dall'ottimizzatore che la vista data non fissa: restano ipotesi (regola di osservabilità). */
  nonOsservabili: string[];
  /** Una misura critica non si vede da questa vista: «Aggiungi una foto di lato». */
  suggerimenti: Array<'foto_lato'>;
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

/** Confidenza di un'ipotesi che la vista non fissa: sotto la soglia delle domande (0,6), mai sopra quella del classificatore. */
const CONFIDENZA_IPOTESI = 0.5;

/**
 * I parametri e i chip da consegnare (§3.5), con la regola di osservabilità: accettato → i parametri ottimizzati
 * **che la vista data fissa** prendono `fonte: silhouette` e confidenza `min(0,9, IoU)`; quelli che l'ottimizzatore ha
 * mosso ma la vista non vede (calo di IoU sotto soglia per ±5 % dell'intervallo, `osservabilita.ts`) restano «ipotesi»
 * con la fonte del classificatore, la sua banda min–max (o quella che la vista non distingue) e confidenza al più 0,5, così
 * i critici fra loro diventano domande-chip (al massimo tre, una alla volta) e compare «Aggiungi una foto di lato». Riserva
 * → stessi valori ma restano «stimata» (confidenza al più 0,7) e chip della vista; avviso → si tiene il migliore, card
 * «Non combacia bene» e tre chip. Gli altri parametri restano del classificatore.
 * @param scheda - Scheda del classificatore (dopo l'eventuale rientro).
 * @param risposta - Risposta della verifica (la migliore).
 * @param esito - Esito della soglia (non `rientro`).
 * @returns La consegna.
 */
export function consegnaVerifica(
  scheda: SchedaPerVerifica,
  risposta: Pick<RispostaVerifica, 'famiglia' | 'variante' | 'iou' | 'parametri' | 'chiaviOttimizzate'> &
    Partial<Pick<RispostaVerifica, 'sensibilita'>>,
  esito: Exclude<EsitoSoglia, 'rientro'>,
): Consegna {
  const ottimizzate = new Set(risposta.chiaviOttimizzate);
  const sensibilita = new Map((risposta.sensibilita ?? []).map((voce) => [voce.chiave, voce]));
  // Senza la misura (tempo, costruzione fallita) un parametro non è osservabile: nessuna misura senza prova.
  const osservabile = (chiave: string): boolean => sensibilita.get(chiave)?.osservabile === true;
  const leggi = (chiave: string): ValoreParametro | undefined => {
    let corrente: unknown = risposta.parametri;
    for (const segmento of chiave.split('.')) {
      corrente = (corrente as Record<string, unknown> | undefined)?.[segmento];
    }
    return corrente as ValoreParametro | undefined;
  };
  const famiglia = famiglie[risposta.famiglia];
  const definizioni = new Map((famiglia?.parametri ?? []).map((definizione) => [definizione.chiave, definizione]));
  const confidenzaSilhouette = esito === 'accettato' ? Math.min(0.9, risposta.iou) : Math.min(0.7, risposta.iou);
  const nonOsservabili: string[] = [];
  const consegna = (
    parametro: Pick<SchedaPerVerifica['parametri'][number], 'chiave' | 'valore' | 'confidenza' | 'fonte'> &
      Partial<Pick<SchedaPerVerifica['parametri'][number], 'min' | 'max'>>,
  ): ParametroConsegnato => {
    if (ottimizzate.has(parametro.chiave) && esito !== 'avviso') {
      if (osservabile(parametro.chiave)) {
        return {
          chiave: parametro.chiave,
          valore: leggi(parametro.chiave) ?? parametro.valore,
          fonte: 'silhouette',
          confidenza: confidenzaSilhouette,
          stato: esito === 'accettato' ? statoDaConfidenza('silhouette', confidenzaSilhouette) : 'stimata',
        };
      }
      // Mosso ma non visto: ipotesi, con la banda. Il valore è quello che la verifica ha dato, dentro la banda.
      nonOsservabili.push(parametro.chiave);
      const banda = sensibilita.get(parametro.chiave)?.banda;
      const min = parametro.min ?? banda?.[0];
      const max = parametro.max ?? banda?.[1];
      return {
        chiave: parametro.chiave,
        valore: leggi(parametro.chiave) ?? parametro.valore,
        fonte: parametro.fonte,
        confidenza: Math.min(parametro.confidenza, CONFIDENZA_IPOTESI),
        stato: 'ipotesi',
        ...(min === undefined || max === undefined ? {} : { min, max }),
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
  };
  const parametri: ParametroConsegnato[] = scheda.parametri.map((parametro) => consegna(parametro));
  // I parametri che l'ottimizzatore ha mosso ma il classificatore non aveva nominato (default della famiglia).
  const nominati = new Set(scheda.parametri.map((parametro) => parametro.chiave));
  for (const chiave of risposta.chiaviOttimizzate) {
    const valore = leggi(chiave);
    if (nominati.has(chiave) || valore === undefined || esito === 'avviso') {
      continue;
    }
    parametri.push(consegna({ chiave, valore, confidenza: 0.3, fonte: 'default_mestiere' }));
  }
  const critici = nonOsservabili.filter((chiave) => definizioni.get(chiave)?.critico === true);
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
    nonOsservabili,
    suggerimenti: critici.length > 0 && esito !== 'avviso' ? ['foto_lato'] : [],
    chip,
    messaggio,
  };
}
