import { z } from 'zod';
import type { DefinizioneParametro, ParametriAnnidati, ValoreParametro } from '#famiglie/famiglia.js';

/**
 * Strumenti comuni per i parametri delle famiglie: una sola sorgente (le `DefinizioneParametro`) da cui nascono
 * schema zod, predefiniti e normalizzazione, così limiti delle Misure, prompt e ricetta non divergono.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Valore a un percorso puntato.
 * @param p - Parametri annidati.
 * @param chiave - Percorso, per esempio `tappo.altezza`.
 * @returns Il valore foglia, o undefined.
 */
export function leggiParametro(p: unknown, chiave: string): unknown {
  let corrente: unknown = p;
  for (const segmento of chiave.split('.')) {
    if (!isRecord(corrente)) {
      return undefined;
    }
    corrente = corrente[segmento];
  }
  return corrente;
}

/**
 * Scrive un valore a un percorso puntato, creando gli oggetti intermedi.
 * @param p - Parametri annidati (modificati sul posto).
 * @param chiave - Percorso puntato.
 * @param valore - Valore foglia.
 */
export function scriviParametro(p: ParametriAnnidati, chiave: string, valore: ValoreParametro): void {
  const segmenti = chiave.split('.');
  let corrente: ParametriAnnidati = p;
  for (const segmento of segmenti.slice(0, -1)) {
    const prossimo = corrente[segmento];
    if (!isRecord(prossimo)) {
      const nuovo: ParametriAnnidati = {};
      corrente[segmento] = nuovo;
      corrente = nuovo;
    } else {
      corrente = prossimo as ParametriAnnidati;
    }
  }
  corrente[segmenti.at(-1)!] = valore;
}

const schemaFoglia = (definizione: DefinizioneParametro): z.ZodType => {
  switch (definizione.unita) {
    case 'enum': {
      const valori = definizione.valori ?? [];
      if (valori.length === 0) {
        throw new TypeError(`Il parametro enum ${definizione.chiave} non elenca valori.`);
      }
      return z.enum(valori as [string, ...string[]]);
    }
    case 'bool': {
      return z.boolean();
    }
    case 'testo': {
      return z.string().max(definizione.lunghezzaMassima ?? 200);
    }
    case 'contorno': {
      return z.array(z.tuple([z.number(), z.number()])).max(definizione.lunghezzaMassima ?? 64);
    }
    case 'n': {
      let schema = z.number().int();
      schema = definizione.min === undefined ? schema : schema.min(definizione.min);
      return definizione.max === undefined ? schema : schema.max(definizione.max);
    }
    default: {
      let schema = z.number();
      schema = definizione.min === undefined ? schema : schema.min(definizione.min);
      return definizione.max === undefined ? schema : schema.max(definizione.max);
    }
  }
};

type AlberoSchema = { [chiave: string]: z.ZodType | AlberoSchema };

const costruisciOggetto = (albero: AlberoSchema): z.ZodType =>
  z.object(
    Object.fromEntries(
      Object.entries(albero).map(([chiave, valore]) => [
        chiave,
        valore instanceof z.ZodType ? valore : costruisciOggetto(valore),
      ]),
    ),
  );

/**
 * Lo schema zod dei parametri non derivati: oggetti annidati per pezzo, numeri con min/max, enum, booleani.
 * @param definizioni - Definizioni della famiglia.
 * @returns Lo schema (il tipo `P` lo dichiara la famiglia).
 */
export function schemaDaParametri<P>(definizioni: readonly DefinizioneParametro[]): z.ZodType<P> {
  const albero: AlberoSchema = {};
  for (const definizione of definizioni) {
    if (definizione.derivato) {
      continue;
    }
    const segmenti = definizione.chiave.split('.');
    let nodo = albero;
    for (const segmento of segmenti.slice(0, -1)) {
      const prossimo = nodo[segmento];
      if (prossimo === undefined || prossimo instanceof z.ZodType) {
        const nuovo: AlberoSchema = {};
        nodo[segmento] = nuovo;
        nodo = nuovo;
      } else {
        nodo = prossimo;
      }
    }
    nodo[segmenti.at(-1)!] = schemaFoglia(definizione);
  }
  return costruisciOggetto(albero) as unknown as z.ZodType<P>;
}

/**
 * I predefiniti annidati dei parametri non derivati, con le sostituzioni di una variante.
 * @param definizioni - Definizioni della famiglia.
 * @param sostituzioni - Valori per percorso puntato che la variante cambia.
 * @returns Parametri annidati nuovi.
 */
export function predefinitiDaParametri<P>(
  definizioni: readonly DefinizioneParametro[],
  sostituzioni: Readonly<Record<string, ValoreParametro>> = {},
): P {
  const p: ParametriAnnidati = {};
  for (const definizione of definizioni) {
    if (!definizione.derivato) {
      scriviParametro(p, definizione.chiave, sostituzioni[definizione.chiave] ?? definizione.default);
    }
  }
  return p as P;
}

/**
 * Normalizza parametri qualsiasi contro le definizioni: completa le chiavi mancanti con `base`, porta i numeri
 * dentro [min, max] (gli interi `n` arrotondati), sostituisce enum e tipi sbagliati con il valore di `base`.
 * Non applica i vincoli fra parametri: lo fa la famiglia dopo.
 * @param definizioni - Definizioni della famiglia.
 * @param p - Parametri da normalizzare (anche parziali).
 * @param base - Predefiniti della variante.
 * @returns Una copia normalizzata.
 */
export function normalizzaConParametri<P>(definizioni: readonly DefinizioneParametro[], p: unknown, base: P): P {
  if (p !== undefined && !isRecord(p)) {
    throw new TypeError('I parametri di una famiglia devono essere un oggetto annidato per pezzo.');
  }
  const risultato = structuredClone(base) as ParametriAnnidati;
  for (const definizione of definizioni) {
    if (definizione.derivato) {
      continue;
    }
    const predefinito = leggiParametro(base, definizione.chiave) as ValoreParametro;
    const grezzo = leggiParametro(p, definizione.chiave);
    let valore: ValoreParametro = predefinito;
    switch (definizione.unita) {
      case 'enum': {
        valore = typeof grezzo === 'string' && definizione.valori?.includes(grezzo) ? grezzo : predefinito;
        break;
      }
      case 'bool': {
        valore = typeof grezzo === 'boolean' ? grezzo : predefinito;
        break;
      }
      case 'testo': {
        valore = typeof grezzo === 'string' ? grezzo.slice(0, definizione.lunghezzaMassima ?? 200) : predefinito;
        break;
      }
      case 'contorno': {
        const punti = Array.isArray(grezzo) ? (grezzo as unknown[]) : undefined;
        const validi = punti?.every(
          (punto) =>
            Array.isArray(punto) &&
            punto.length === 2 &&
            punto.every((v) => typeof v === 'number' && Number.isFinite(v)),
        );
        valore =
          punti && validi
            ? (punti as [number, number][])
                .slice(0, definizione.lunghezzaMassima ?? 64)
                .map(([x, y]) => [x, y] as const)
            : predefinito;
        break;
      }
      default: {
        if (typeof grezzo === 'number' && Number.isFinite(grezzo)) {
          const passo = definizione.passo ?? 1;
          let numero = definizione.unita === 'n' ? Math.round(grezzo / passo) * passo : grezzo;
          numero = definizione.min === undefined ? numero : Math.max(definizione.min, numero);
          numero = definizione.max === undefined ? numero : Math.min(definizione.max, numero);
          valore = numero;
        }
      }
    }
    scriviParametro(risultato, definizione.chiave, valore);
  }
  return risultato as P;
}

/**
 * I valori dei parametri derivati, per le Misure (mostrati, non modificabili).
 * @param definizioni - Definizioni della famiglia.
 * @param p - Parametri normalizzati.
 * @returns Mappa percorso puntato → valore.
 */
export function valoriDerivati(
  definizioni: readonly DefinizioneParametro[],
  p: ParametriAnnidati,
): Record<string, number | boolean> {
  return Object.fromEntries(
    definizioni.flatMap((definizione) =>
      definizione.derivato ? [[definizione.chiave, definizione.derivato(p)] as const] : [],
    ),
  );
}

/**
 * Interpolazione cubica monotona (Fritsch–Carlson) per punti in ascissa crescente: passa per i punti senza
 * superarli (niente sovraelongazioni della vita di un tacco).
 * @param punti - Coppie `[t, valore]` con t crescente.
 * @param t - Ascissa.
 * @returns Il valore interpolato (costante fuori dall'intervallo).
 */
export function interpolaMonotona(punti: readonly (readonly [number, number])[], t: number): number {
  const n = punti.length;
  if (n === 0) {
    return Number.NaN;
  }
  if (n === 1 || t <= punti[0]![0]) {
    return punti[0]![1];
  }
  if (t >= punti[n - 1]![0]) {
    return punti[n - 1]![1];
  }
  const secanti = punti.slice(0, -1).map(([t0, v0], indice) => {
    const [t1, v1] = punti[indice + 1]!;
    return (v1 - v0) / (t1 - t0);
  });
  const tangenti = punti.map((_, indice) => {
    if (indice === 0) {
      return secanti[0]!;
    }
    if (indice === n - 1) {
      return secanti[n - 2]!;
    }
    const a = secanti[indice - 1]!;
    const b = secanti[indice]!;
    return a * b <= 0 ? 0 : (a + b) / 2;
  });
  for (const [indice, secante] of secanti.entries()) {
    if (secante === 0) {
      tangenti[indice] = 0;
      tangenti[indice + 1] = 0;
      continue;
    }
    const alfa = tangenti[indice]! / secante;
    const beta = tangenti[indice + 1]! / secante;
    const somma = alfa * alfa + beta * beta;
    if (somma > 9) {
      const tau = 3 / Math.sqrt(somma);
      tangenti[indice] = tau * alfa * secante;
      tangenti[indice + 1] = tau * beta * secante;
    }
  }
  const k = punti.findIndex(([t1], indice) => indice > 0 && t <= t1) - 1;
  const [t0, v0] = punti[k]!;
  const [t1, v1] = punti[k + 1]!;
  const h = t1 - t0;
  const s = (t - t0) / h;
  const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
  const h10 = s ** 3 - 2 * s ** 2 + s;
  const h01 = -2 * s ** 3 + 3 * s ** 2;
  const h11 = s ** 3 - s ** 2;
  return h00 * v0 + h10 * h * tangenti[k]! + h01 * v1 + h11 * h * tangenti[k + 1]!;
}

/**
 * Limita un numero all'intervallo.
 * @param valore - Numero.
 * @param minimo - Limite inferiore.
 * @param massimo - Limite superiore.
 * @returns Il numero limitato.
 */
export const limita = (valore: number, minimo: number, massimo: number): number =>
  Math.min(massimo, Math.max(minimo, valore));

/** Gradi in radianti. */
export const radianti = (gradi: number): number => (gradi * Math.PI) / 180;
