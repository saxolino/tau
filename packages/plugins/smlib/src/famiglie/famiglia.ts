import type { z } from 'zod';
import type * as Smlib from '@classcad/smlibwasm';
import type { NamedInputShape } from '#utils/render-output.js';

/**
 * Contratto delle famiglie parametriche di SinopiaCAD (specifica D1, §1.0).
 *
 * Una famiglia è una ricetta TypeScript pura sopra `@classcad/smlibwasm`: dai parametri (mm, gradi, Z in alto)
 * costruisce pezzi nominati e ne misura la producibilità. Gira nel worker del kernel e nei test Node.
 */

/** Processi produttivi per cui le verifiche conoscono le soglie (§1.10). */
export type Processo =
  | 'fusione_cera_persa'
  | 'pressofusione_zama'
  | 'stampaggio_iniezione'
  | 'tranciatura_lamiera'
  | 'cnc'
  | 'stampa_3d_resina'
  | 'taglio_cuoio';

/** Identificativi delle famiglie previste dalla specifica (non tutte già realizzate: vedi `famiglie` in index). */
export type IdFamiglia =
  | 'tacco'
  | 'fondo_semplice'
  | 'fibbia'
  | 'occhiello'
  | 'borchia'
  | 'placca'
  | 'puntale'
  | 'anello'
  | 'pendente';

/** Unità di un parametro: `testo` per le stringhe libere (contenuto della placca). */
export type UnitaParametro = 'mm' | 'deg' | 'n' | 'bool' | 'enum' | 'frazione' | 'testo';

/** Da dove viene il valore predefinito: regola del mestiere, calcolo da altri, o scelta nostra dichiarata. */
export type FonteDefault = 'mestiere' | 'derivato' | 'scelta_nostra';

/** Valore di un parametro foglia. */
export type ValoreParametro = number | string | boolean;

/** Parametri annidati per pezzo (`{ tacco: { altezza: 85 } }`), come chiede la skill delle Misure. */
export type ParametriAnnidati = { [chiave: string]: ValoreParametro | ParametriAnnidati };

/** Descrizione di un parametro: limiti, unità, predefinito e provenienza (per Misure, D2 e D3). */
export type DefinizioneParametro = {
  /** Percorso puntato, per esempio `tappo.altezza`. */
  chiave: string;
  unita: UnitaParametro;
  min?: number;
  max?: number;
  passo?: number;
  /** Predefinito della variante base; le varianti lo cambiano con `predefiniti(variante)`. */
  default: ValoreParametro;
  /** Valori ammessi per `enum`. */
  valori?: readonly string[];
  /** Lunghezza massima per `testo`. */
  lunghezzaMassima?: number;
  fonteDefault: FonteDefault;
  /** Parametro di produzione: sotto la soglia di confidenza si chiede all'utente (§2.6). */
  critico?: boolean;
  /** Il parametro cambia la silhouette: l'ottimizzatore di D3 lo può muovere (§3.4). */
  silhouetteSensibile?: boolean;
  /** Calcolato da altri parametri: mostrato, non modificabile, assente dai parametri `P`. */
  derivato?: (p: ParametriAnnidati) => number | boolean;
  /** Etichetta breve in italiano per le Misure e il prompt del classificatore. */
  descrizione?: string;
};

/** Esito di una verifica di producibilità (§1.10). */
export type Esito = {
  livello: 'ok' | 'avviso' | 'blocco' | 'info';
  codice: string;
  pezzo?: string;
  valore?: number;
  soglia?: number;
  messaggio: string;
};

/** Un pezzo restituito da una famiglia: la forma per il kernel, con ruolo e materiale dichiarati. */
export type PezzoFamiglia = NamedInputShape & {
  /** Ruolo del pezzo nella famiglia (`corpo`, `tappo`, `anima`, `telaio`, `ardiglione`, `pietra`…). */
  ruolo: string;
  /** Chiave di `materiali.ts` (densità e colore vengono da lì). */
  materiale: string;
};

/** Opzioni di costruzione e di verifica: la variante della famiglia. */
export type OpzioniFamiglia = { variante?: string };

/** Pezzi e avvisi di costruzione (raccordo ridotto, testo ridotto, solido non valido…). */
export type RisultatoCostruzione = { pezzi: PezzoFamiglia[]; esiti: Esito[] };

/** Piani di simmetria e assi utili alla verifica della silhouette (D3). */
export type SilhouetteFamiglia = { assi: readonly ('x' | 'y' | 'z')[]; simmetrie: readonly ('yz' | 'xz')[] };

/** Una famiglia parametrica (contratto di §1.0, con la variante come opzione esplicita). */
export type Famiglia<P extends ParametriAnnidati = ParametriAnnidati> = {
  id: IdFamiglia;
  /** Entra nell'impronta della ricetta: si incrementa quando la geometria cambia a parità di parametri. */
  versione: number;
  varianti: readonly string[];
  /** Tassonomia `supplier_products.part_type` (§2.1). */
  partTypes: readonly string[];
  /** Parametri validati: i min/max dello schema sono i limiti delle Misure. */
  schema: z.ZodType<P>;
  parametri: readonly DefinizioneParametro[];
  /** Parametri predefiniti di una variante (la prima se assente). */
  predefiniti: (variante?: string) => P;
  /** Vincoli violati (vuoto = coerente). */
  vincoli: (p: P) => readonly { chiave: string; messaggio: string }[];
  /** Riporta dentro limiti e vincoli; completa le chiavi mancanti; lancia solo se `p` non è un oggetto. */
  normalizza: (p: unknown, opzioni?: OpzioniFamiglia) => P;
  /** Pezzi nominati, ciascuno già passato da `fromSmb(toSmb())`; mai lancia. */
  costruisci: (lib: typeof Smlib, p: P, opzioni?: OpzioniFamiglia) => PezzoFamiglia[];
  /** Come `costruisci`, con gli avvisi nati durante la costruzione. */
  costruisciConEsiti: (lib: typeof Smlib, p: P, opzioni?: OpzioniFamiglia) => RisultatoCostruzione;
  /** Verifiche di producibilità con soglie per processo (§1.10). */
  verifiche: (
    lib: typeof Smlib,
    pezzi: readonly PezzoFamiglia[],
    p: P,
    processo?: Processo,
    opzioni?: OpzioniFamiglia,
  ) => Esito[];
  silhouette: SilhouetteFamiglia;
  /** Chiavi di `materiali.ts`. */
  materialiAmmessi: readonly string[];
  /** Il `main.ts` del progetto (§1.0.1), che importa la famiglia dal modulo `@sinopia/famiglie`. */
  emettiMain: (p: P, ipotesi: Record<string, string>, opzioni?: OpzioniFamiglia) => string;
};

/** Una famiglia di parametri qualsiasi, per il registro. */
// oxlint-disable-next-line typescript/no-explicit-any -- the registry stores families of different parameter types.
export type FamigliaQualsiasi = Famiglia<any>;
