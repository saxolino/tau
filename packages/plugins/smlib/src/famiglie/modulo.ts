import type * as Smlib from '@classcad/smlibwasm';
import type {
  DefinizioneParametro,
  Esito,
  FamigliaQualsiasi,
  OpzioniFamiglia,
  PezzoFamiglia,
  Processo,
  RisultatoCostruzione,
} from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';

/**
 * Una famiglia legata alla libreria del kernel: è ciò che il `main.ts` di un progetto importa da
 * `@sinopia/famiglie` (`tacco.costruisci(p, { variante })`). I parametri passano sempre da `normalizza`, quindi un
 * `defaultParams` parziale o fuori limite costruisce comunque il pezzo coerente più vicino.
 * @public
 */
export type FamigliaLegata = {
  id: string;
  versione: number;
  varianti: readonly string[];
  parametri: readonly DefinizioneParametro[];
  predefiniti: (variante?: string) => unknown;
  normalizza: (p: unknown, opzioni?: OpzioniFamiglia) => unknown;
  costruisci: (p: unknown, opzioni?: OpzioniFamiglia) => PezzoFamiglia[];
  costruisciConEsiti: (p: unknown, opzioni?: OpzioniFamiglia) => RisultatoCostruzione;
  verifiche: (
    pezzi: readonly PezzoFamiglia[],
    p: unknown,
    opzioni?: OpzioniFamiglia & { processo?: Processo },
  ) => Esito[];
};

/**
 * Una famiglia legata alla libreria. Costruzioni e verifiche girano dentro `lib.scope`: i corpi intermedi di una
 * ricetta (operandi delle booleane, schizzi, gusci, mesh di controllo) si liberano appena la ricetta finisce, invece
 * che quando passa il garbage collector, che fra un turno dell'event loop e l'altro non arriva. Restano vivi solo i
 * pezzi restituiti.
 * @param lib - La libreria del kernel.
 * @param famiglia - La famiglia del registro.
 * @returns La famiglia legata.
 */
const lega = (lib: typeof Smlib, famiglia: FamigliaQualsiasi): FamigliaLegata => ({
  id: famiglia.id,
  versione: famiglia.versione,
  varianti: famiglia.varianti,
  parametri: famiglia.parametri,
  predefiniti: (variante): unknown => famiglia.predefiniti(variante) as unknown,
  normalizza: (p, opzioni): unknown => famiglia.normalizza(p, opzioni) as unknown,
  costruisci: (p, opzioni) => lib.scope(() => famiglia.costruisci(lib, famiglia.normalizza(p, opzioni), opzioni)),
  costruisciConEsiti: (p, opzioni) =>
    lib.scope(() => famiglia.costruisciConEsiti(lib, famiglia.normalizza(p, opzioni), opzioni)),
  verifiche: (pezzi, p, opzioni) =>
    lib.scope(() => famiglia.verifiche(lib, pezzi, famiglia.normalizza(p, opzioni), opzioni?.processo, opzioni)),
});

/**
 * Le esportazioni del modulo built-in `@sinopia/famiglie` per una libreria SMLib: una famiglia legata per id
 * (`fibbia`, `tacco`, `placca`…) e l'elenco `famiglie`.
 * @param lib - La libreria del kernel (la stessa che il kernel usa per leggere i pezzi restituiti da `main`).
 * @returns Le esportazioni del modulo.
 * @public
 */
export function creaModuloFamiglie(lib: typeof Smlib): Record<string, unknown> {
  const legate: Record<string, FamigliaLegata> = Object.fromEntries(
    Object.values(famiglie).map((famiglia) => [famiglia.id, lega(lib, famiglia)]),
  );
  return { ...legate, famiglie: legate };
}
