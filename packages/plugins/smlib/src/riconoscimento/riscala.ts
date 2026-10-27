import type { FamigliaCatalogo } from '#riconoscimento/condiviso.js';
import { confidenzaScala } from '#riconoscimento/scala.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';

/**
 * Riscalare un pezzo riconosciuto quando l'utente dà la misura nota che chiedeva il chip della scala (§2.6): le
 * misure in mm che il classificatore ha stimato con una scala ipotizzata valgono `valore · pxPerMm_vecchio / pxPerMm_nuovo`
 * (la foto non cambia: cambia quanti pixel fanno un millimetro). Angoli, frazioni e conteggi non dipendono dalla scala.
 */

/**
 * La scheda con la scala data dall'utente (fonte `misura_nota`, confidenza 0,95) e le misure in mm riportate ad essa.
 * @param scheda - La scheda di riconoscimento.
 * @param nuova - Pixel per mm misurati sulla maschera con la misura nota, e che cosa si è misurato.
 * @param famiglia - La famiglia del catalogo, per sapere quali parametri sono in mm.
 * @returns La scheda riscalata.
 * @public
 */
export function riscalaScheda(
  scheda: SchedaRiconoscimento,
  nuova: Readonly<{ pxPerMm: number; riferimento: string }>,
  famiglia: FamigliaCatalogo | undefined,
): SchedaRiconoscimento {
  // Senza una scala di partenza non c'è un rapporto: i valori restano, e la verifica li porta alla nuova scala.
  const fattore = scheda.scala.pxPerMm === null ? 1 : scheda.scala.pxPerMm / nuova.pxPerMm;
  const inMm = new Set(famiglia?.parametri.filter((definizione) => definizione.unita === 'mm').map((d) => d.chiave));
  const parametri = scheda.parametri.map((parametro) =>
    inMm.has(parametro.chiave) && typeof parametro.valore === 'number'
      ? {
          ...parametro,
          valore: parametro.valore * fattore,
          ...(parametro.min === undefined ? {} : { min: parametro.min * fattore }),
          ...(parametro.max === undefined ? {} : { max: parametro.max * fattore }),
        }
      : parametro,
  );
  return {
    ...scheda,
    parametri,
    scala: {
      pxPerMm: nuova.pxPerMm,
      fonte: 'misura_nota',
      riferimento: nuova.riferimento.slice(0, 140),
      confidenza: confidenzaScala.misura,
    },
  };
}
