import type { Consegna } from '#verifica/pipeline.js';
import type { FamigliaCatalogo } from '#riconoscimento/condiviso.js';
import type { SchedaRiconoscimento } from '#riconoscimento/schema.js';

/**
 * Dalla consegna della verifica D3 alla scheda di riconoscimento che il resto del CAD legge (`pianoCostruzione`, le
 * domande, le Misure): i valori ottimizzati entrano nei parametri con confidenza, banda e motivo, così il `main.ts`
 * porta il marcatore `[sinopia:assumed c= f= min= max=]` esattamente dei parametri che la vista non fissa, e i critici
 * fra loro tornano a essere domande (confidenza sotto 0,6) senza altro meccanismo.
 */

const testi = {
  it: {
    misurato: (iou: string) => `Misurato sulla silhouette della foto (IoU ${iou}).`,
    stimato: (iou: string) => `Stimato sulla silhouette (IoU ${iou}): controlla la vista.`,
    nonVisto: 'La vista non fissa questa misura: resta un’ipotesi. Una foto di lato la misura.',
  },
  en: {
    misurato: (iou: string) => `Measured on the photo's silhouette (IoU ${iou}).`,
    stimato: (iou: string) => `Estimated on the silhouette (IoU ${iou}): check the view.`,
    nonVisto: 'The view does not fix this measure: it stays an assumption. A side photo would measure it.',
  },
} as const;

/**
 * La scheda dopo la verifica: i parametri della consegna (valori ottimizzati, confidenze, bande) al posto di quelli del
 * classificatore. La fonte di un parametro misurato sulla silhouette resta quella del classificatore (lo schema D2 non
 * ha «silhouette» fra le fonti, e il contratto con la funzione di Sinopia non cambia): conta la confidenza, che sale
 * a `min(0,9, IoU)` solo per i parametri che la vista fissa.
 * @param scheda - La scheda del classificatore (quella da cui è nata la consegna).
 * @param consegna - La consegna della verifica.
 * @param opzioni - Lingua dei motivi.
 * @param catalogo - La famiglia del catalogo, per sapere quali chiavi esistono.
 * @returns La scheda con i parametri consegnati.
 * @public
 */
export function schedaConsegnata(
  scheda: SchedaRiconoscimento,
  consegna: Consegna,
  opzioni: Readonly<{ lingua: 'it' | 'en'; catalogo?: FamigliaCatalogo }> = { lingua: 'it' },
): SchedaRiconoscimento {
  const testo = testi[opzioni.lingua];
  const iou = consegna.iou.toLocaleString(opzioni.lingua === 'it' ? 'it-IT' : 'en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const ammesse = opzioni.catalogo
    ? new Set(opzioni.catalogo.parametri.map((definizione) => definizione.chiave))
    : undefined;
  const precedenti = new Map(scheda.parametri.map((parametro) => [parametro.chiave, parametro]));
  const parametri = consegna.parametri
    // Un elenco di punti (il contorno della placca) non è un valore della scheda: resta nei parametri del progetto.
    .flatMap((parametro) => (typeof parametro.valore === 'object' ? [] : [{ ...parametro, valore: parametro.valore }]))
    .filter((parametro) => ammesse === undefined || ammesse.has(parametro.chiave))
    .map((parametro): SchedaRiconoscimento['parametri'][number] => {
      const prima = precedenti.get(parametro.chiave);
      const dallaSilhouette = parametro.fonte === 'silhouette';
      const fonte = parametro.fonte === 'silhouette' ? (prima?.fonte ?? 'proporzione') : parametro.fonte;
      const motivo = dallaSilhouette
        ? parametro.stato === 'misurata'
          ? testo.misurato(iou)
          : testo.stimato(iou)
        : consegna.nonOsservabili.includes(parametro.chiave)
          ? testo.nonVisto
          : (prima?.motivo ?? '');
      return {
        chiave: parametro.chiave,
        valore: parametro.valore,
        ...(parametro.min === undefined || parametro.max === undefined
          ? prima?.min === undefined || prima.max === undefined
            ? {}
            : { min: prima.min, max: prima.max }
          : { min: parametro.min, max: parametro.max }),
        confidenza: parametro.confidenza,
        fonte,
        motivo: motivo.slice(0, 140),
      };
    });
  return { ...scheda, parametri };
}
