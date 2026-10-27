import type { FamigliaCatalogo, ParametroCatalogo } from '#riconoscimento/condiviso.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';
import { soglie } from '#riconoscimento/soglie.js';

/**
 * Le domande del riconoscimento (specifica D2 §2.6): costruite senza modello dalla scheda, una alla volta, al massimo
 * tre per riconoscimento, in ordine d'importanza (critiche e meno sicure prima).
 */

/** La famiglia è incerta: si chiede prima di costruire. @public */
export type DomandaFamiglia = Readonly<{ tipo: 'famiglia'; opzioni: readonly string[] }>;
/** Un parametro critico incerto: tre proposte ordinate, la centrale è la stima. @public */
export type DomandaParametro = Readonly<{
  tipo: 'parametro';
  chiave: string;
  unita: string;
  motivo: string;
  proposte: readonly [number, number, number];
  min?: number;
  max?: number;
}>;
/** La scala è stimata: si chiede una misura nota prima di esportare. @public */
export type DomandaScala = Readonly<{ tipo: 'scala' }>;
/** Una domanda del riconoscimento. @public */
export type DomandaRiconoscimento = DomandaFamiglia | DomandaParametro | DomandaScala;

/**
 * La domanda sulla famiglia, se la sua confidenza è sotto soglia: la famiglia proposta, le alternative (al massimo tre
 * in tutto) e «Altro» (pezzo libero) per ultimo.
 * @param scheda - La scheda di riconoscimento.
 * @returns La domanda, o undefined.
 * @public
 */
export function domandaFamiglia(scheda: SchedaRiconoscimento): DomandaFamiglia | undefined {
  if (scheda.famiglia.confidenza >= soglie.famiglia || scheda.famiglia.id === 'non_modellabile') {
    return undefined;
  }
  const candidate = [scheda.famiglia, ...scheda.famiglia.alternative]
    .filter((voce) => voce.id !== 'libero' && voce.id !== 'non_modellabile')
    .map((voce) => voce.id);
  return { tipo: 'famiglia', opzioni: [...[...new Set(candidate)].slice(0, 3), 'libero'] };
}

const arrotonda = (valore: number, passo: number): number => Math.round(valore / passo) * passo;

const proposteDa = (
  valore: number,
  definizione: ParametroCatalogo,
  banda: Readonly<{ min?: number; max?: number }>,
): [number, number, number] => {
  const passo = definizione.unita === 'n' ? 1 : (definizione.passo ?? (valore >= 20 ? 1 : 0.5));
  const ampiezza =
    banda.min !== undefined && banda.max !== undefined && banda.max > banda.min
      ? (banda.max - banda.min) / 2
      : Math.max(Math.abs(valore) * 0.06, passo);
  const salto = Math.max(passo, arrotonda(ampiezza, passo));
  const dentro = (numero: number): number =>
    Math.min(definizione.max ?? Infinity, Math.max(definizione.min ?? -Infinity, arrotonda(numero, passo)));
  const centro = dentro(valore);
  return [dentro(centro - salto), centro, dentro(centro + salto)];
};

/**
 * Le domande sui parametri critici con confidenza sotto soglia, ordinate per confidenza crescente, tolte quelle già
 * risposte, al massimo tre. Le proposte sono quelle del classificatore se ce ne sono, altrimenti nascono dalla banda
 * min–max (o dal ±6 %) attorno alla stima.
 * @param scheda - La scheda di riconoscimento (normalizzata).
 * @param famiglia - La famiglia del catalogo.
 * @param risposte - Le chiavi già fissate dall'utente.
 * @returns Le domande, nell'ordine in cui porle.
 * @public
 */
export function domandeParametri(
  scheda: SchedaRiconoscimento,
  famiglia: FamigliaCatalogo,
  risposte: ReadonlySet<string> = new Set(),
): DomandaParametro[] {
  const definizioni = new Map(famiglia.parametri.map((definizione) => [definizione.chiave, definizione]));
  const proposteDelModello = new Map(scheda.domande.map((domanda) => [domanda.chiave, domanda]));
  return scheda.parametri
    .flatMap((parametro) => {
      const definizione = definizioni.get(parametro.chiave);
      if (
        !definizione?.critico ||
        typeof parametro.valore !== 'number' ||
        parametro.confidenza >= soglie.critico ||
        risposte.has(parametro.chiave)
      ) {
        return [];
      }
      const delModello = proposteDelModello.get(parametro.chiave);
      const proposte =
        delModello?.proposte.length === 3
          ? ([delModello.proposte[0]!, delModello.proposte[1]!, delModello.proposte[2]!] as [number, number, number])
          : proposteDa(parametro.valore, definizione, parametro);
      const domanda: DomandaParametro = {
        tipo: 'parametro',
        chiave: parametro.chiave,
        unita: definizione.unita,
        motivo: delModello?.motivo ?? parametro.motivo,
        proposte,
        ...(definizione.min === undefined ? {} : { min: definizione.min }),
        ...(definizione.max === undefined ? {} : { max: definizione.max }),
      };
      return [{ domanda, confidenza: parametro.confidenza }];
    })
    .toSorted((a, b) => a.confidenza - b.confidenza)
    .slice(0, soglie.domandeMassime)
    .map(({ domanda }) => domanda);
}

/**
 * La prossima domanda da mostrare (una alla volta): la famiglia prima di tutto, poi i parametri critici, poi la scala
 * stimata. Le domande già poste contano nel tetto di tre.
 * @param scheda - La scheda di riconoscimento.
 * @param famiglia - La famiglia del catalogo (assente se la famiglia non ha ricetta).
 * @param stato - Le chiavi già risposte e se la scala è già stata data.
 * @returns La domanda, o undefined quando non resta niente da chiedere.
 * @public
 */
export function prossimaDomanda(
  scheda: SchedaRiconoscimento,
  famiglia: FamigliaCatalogo | undefined,
  stato: Readonly<{ risposte: ReadonlySet<string>; famigliaScelta?: boolean; scalaData?: boolean }>,
): DomandaRiconoscimento | undefined {
  if (!stato.famigliaScelta) {
    const perFamiglia = domandaFamiglia(scheda);
    if (perFamiglia) {
      return perFamiglia;
    }
  }
  if (famiglia === undefined) {
    return undefined;
  }
  const fatte = [...stato.risposte].filter((chiave) => chiave !== 'scala').length;
  const restanti = Math.max(0, soglie.domandeMassime - fatte);
  const [parametro] = domandeParametri(scheda, famiglia, stato.risposte).slice(0, restanti);
  if (parametro) {
    return parametro;
  }
  return scheda.scala.fonte === 'stima' && !stato.scalaData ? { tipo: 'scala' } : undefined;
}
