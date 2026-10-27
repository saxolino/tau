import type { MascheraBinaria } from '#verifica/silhouette.js';

/**
 * Osservabilità dei parametri nella vista data (decisione di prodotto sulla verifica D3): un parametro che
 * l'ottimizzatore ha mosso diventa «misurato» SOLO se la vista lo fissa.
 *
 * Alla camera finale, per ogni parametro sensibile, si perturba il valore di ±{@link PASSO_OSSERVABILITA} dell'intervallo
 * (differenza finita centrata), si lascia alla camera il tempo di riadattarsi (la camera assorbe buona parte dell'errore
 * di un parametro: senza questo, una vista di fianco «vedrebbe» la larghezza) e si misura di quanto cala l'IoU con la
 * maschera: il **degrado**. Sotto {@link SOGLIA_OSSERVABILITA} la foto non distingue il valore ottimizzato da uno
 * spostato del 5 % dell'intervallo: il parametro resta un'ipotesi, con la banda dei valori che la vista non distingue.
 * Si misura anche la **sensibilità** della silhouette (frazione d'area che cambia a camera ferma), tenuta come dato.
 *
 * **Soglia, e perché: calo di IoU del 2,5 %.** Il pavimento di discretizzazione a 256² è IoU 0,988–0,996 anche con i
 * parametri VERI (set sintetico: «IoU alla verità»): fino all'1,2 % dell'area differisce senza che nessun parametro sia
 * sbagliato, e il bordo di una maschera SAM aggiunge altrettanto. La soglia è il doppio del peggior pavimento: un calo
 * sotto il 2,5 % per uno spostamento del 5 % dell'intervallo sta dentro il rumore, e l'ottimizzatore non può distinguere
 * il valore giusto da uno sbagliato di quell'ordine. Calibrata sul set sintetico (30 pezzi, 9 famiglie, vedi
 * `set-sintetico.ts`): con una sola vista i parametri che l'ottimizzatore lascia sbagliati di 2–9 mm (larghezza di seduta
 * e di tappo, lunghezza di seduta e di tappo del blocco, bombature) hanno un degrado dello 0,0–1,3 %; con il 2,5 % anche
 * l'altezza di un blocco rimasta 5 mm fuori (2,4 %) resta ipotesi, mentre le misure che la vista fissa entro 0,05–2 mm
 * (altezza, lunghezza di seduta e di tappo del tacco di fianco, diametri di occhiello, borchia, pendente, flangia) stanno
 * tra il 2,7 % e il 50 %. Il passo del 5 % e la soglia vanno insieme: la banda è il valore ± lo spostamento che porterebbe
 * il degrado alla soglia (il degrado è lineare vicino all'ottimo).
 */

/** Frazione dell'intervallo con cui si perturba un parametro (differenza finita centrata). */
export const PASSO_OSSERVABILITA = 0.05;

/** Calo di IoU (con la camera riadattata) sotto cui un parametro non è osservabile nella vista. */
export const SOGLIA_OSSERVABILITA = 0.025;

/** Costo di una ricostruzione oltre il quale la sensibilità si misura da un solo lato (ms). */
export const COSTO_LENTO_MS = 400;

/** La sensibilità di un parametro alla vista data. */
export type SensibilitaParametro = {
  chiave: string;
  /** Frazione dell'area della silhouette che cambia per ±5 % dell'intervallo (la maggiore dei due versi). */
  sensibilita: number;
  /** Quanto cala l'IoU con ±5 % dell'intervallo, dopo che la camera si è riadattata (media dei due versi). */
  degrado: number;
  osservabile: boolean;
  /**
   * La banda di valori che la vista non distingue: il valore ± lo spostamento che cambierebbe la silhouette quanto la
   * soglia (la sensibilità è lineare vicino al valore), limitata all'intervallo del parametro.
   */
  banda: readonly [number, number];
};

/**
 * Quanto differiscono due silhouette, in frazione dell'area della prima, dentro la regione valida.
 * @param base - La silhouette di riferimento.
 * @param altra - La silhouette perturbata.
 * @param valida - Regione valida (1 = conta); assente = tutta.
 * @returns Pixel diversi / pixel accesi della base (almeno 1).
 */
export function differenzaSilhouette(base: MascheraBinaria, altra: MascheraBinaria, valida?: Uint8Array): number {
  let diversi = 0;
  let accesi = 0;
  for (let indice = 0; indice < base.dati.length; indice++) {
    if (valida && valida[indice] === 0) {
      continue;
    }
    accesi += base.dati[indice]!;
    diversi += base.dati[indice] === altra.dati[indice] ? 0 : 1;
  }
  return diversi / Math.max(1, accesi);
}

/**
 * Esito di osservabilità di un parametro dalle sue misure.
 * @param chiave - Chiave puntata.
 * @param misure - Sensibilità (area) e degrado (IoU) per ±5 % dell'intervallo.
 * @param valore - Valore ottimizzato.
 * @param intervallo - Limiti del parametro.
 * @param soglia - Soglia del degrado (predefinita {@link SOGLIA_OSSERVABILITA}).
 * @returns Il parametro con flag di osservabilità e banda non distinta.
 */
export function esitoOsservabilita(
  chiave: string,
  misure: Readonly<{ sensibilita: number; degrado: number }>,
  valore: number,
  intervallo: readonly [number, number],
  soglia: number = SOGLIA_OSSERVABILITA,
): SensibilitaParametro {
  const [minimo, massimo] = intervallo;
  const passo = PASSO_OSSERVABILITA * (massimo - minimo);
  // Spostamento che porterebbe il degrado alla soglia: il degrado cresce linearmente con lo spostamento.
  const mezzaBanda =
    misure.degrado <= 1e-9 ? massimo - minimo : Math.min(massimo - minimo, (passo * soglia) / misure.degrado);
  return {
    chiave,
    sensibilita: misure.sensibilita,
    degrado: misure.degrado,
    osservabile: misure.degrado >= soglia,
    banda: [Math.max(minimo, valore - mezzaBanda), Math.min(massimo, valore + mezzaBanda)],
  };
}
