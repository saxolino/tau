import { workbenchPaths, workbenchRecords } from '@taucad/workbench';
import { findPieceMaterial } from '@taucad/viewer/cad/piece-materials';
import { materialiPerPezzo, pianoCostruzione } from '@taucad/smlib/riconoscimento';
import type { PianoCostruzione, SchedaParte, SchedaRiconoscimento } from '@taucad/smlib/riconoscimento';
import {
  percorsoMaschera,
  percorsoRiconoscimento,
  percorsoVista,
  serializzaRecordRiconoscimento,
} from '#services/riconoscimento-record.js';
import type { RecordRiconoscimento } from '#services/riconoscimento-record.js';

/**
 * From a recognition to the files of the new CAD project (D2 §0 step 6): the family's `main.ts` (it imports the recipe
 * from `@sinopia/famiglie`), the record `.tau/workbench/riconoscimento.json`, and the part's picture and mask under
 * `riferimenti/` (the designer's own reference, beside the model, as the home's Sinopia images are), and, when the
 * recognised material has a viewer material, `.tau/workbench/entries.json` with the material of each piece (the
 * viewer shows and weighs them in it).
 */

/** A project file as `createProject` takes it. */
type FileProgetto = { content: Uint8Array<ArrayBuffer> };

const estensioni: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const testo = (valore: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(valore);

/** Una vista generata da tenere nel progetto: i suoi byte, il ruolo, la faccia, l'asset di Sinopia e l'IoU. */
export type VistaDelProgetto = Readonly<{
  ruolo: 'principale' | 'controllo';
  faccia: string;
  assetId: string;
  bytes: Uint8Array<ArrayBuffer>;
  tipo: string;
  iou?: number;
  riusata?: boolean;
}>;

/** The files, the record and the plan of a recognised piece. */
export type ProgettoRiconosciuto = Readonly<{
  files: Record<string, FileProgetto>;
  record: RecordRiconoscimento;
  piano: PianoCostruzione;
  nome: string;
}>;

/**
 * The project of a recognised piece, or undefined when its family has no recipe (`libero`, `non_modellabile`).
 *
 * @param ingresso - The recognition, the part sheet, the picture and mask bytes, the language of generated reasons,
 * and the family the designer chose at the family chip (if any).
 * @returns Files, record, plan and project name.
 */
export function progettoRiconosciuto(
  ingresso: Readonly<{
    scheda: SchedaRiconoscimento;
    schedaParte: SchedaParte;
    immagine: Readonly<{ bytes: Uint8Array<ArrayBuffer>; tipo: string }>;
    maschera?: Uint8Array<ArrayBuffer>;
    lingua: 'it' | 'en';
    famigliaScelta?: string;
    /** The D3 check: its result, or why there is none (`saltata` stopped by the designer, `errore` failed). */
    verifica?: RecordRiconoscimento['verifica'];
    /** Le viste generate usate: in `riferimenti/` con il loro ruolo, e nel record. */
    viste?: readonly VistaDelProgetto[];
    /** Il verdetto dei confronti sulle tre immagini. */
    confronti?: RecordRiconoscimento['confronti'];
    adesso?: Date;
  }>,
): ProgettoRiconosciuto | undefined {
  const piano = pianoCostruzione(ingresso.scheda, {
    lingua: ingresso.lingua,
    ...(ingresso.famigliaScelta === undefined ? {} : { famiglia: ingresso.famigliaScelta }),
  });
  if (piano === undefined) {
    return undefined;
  }
  const creato = (ingresso.adesso ?? new Date()).toISOString();
  const idParte = ingresso.schedaParte.parte.id;
  const viste = ingresso.viste ?? [];
  const record: RecordRiconoscimento = {
    version: 1,
    creato,
    schedaParte: ingresso.schedaParte,
    scheda: ingresso.scheda,
    famiglia: { id: piano.famiglia, variante: piano.variante, scelta: ingresso.famigliaScelta !== undefined },
    risposte: {},
    scalaData: ingresso.scheda.scala.fonte !== 'stima',
    mainScritto: piano.main,
    verifica: ingresso.verifica ?? { stato: 'non_disponibile', motivo: 'non_eseguita' },
    ...(viste.length > 0
      ? {
          viste: viste.map((vista) => ({
            ruolo: vista.ruolo,
            faccia: vista.faccia,
            assetId: vista.assetId,
            file: percorsoVista(idParte, vista.ruolo, vista.tipo),
            ...(vista.iou === undefined ? {} : { iou: vista.iou }),
            ...(vista.riusata ? { riusata: true } : {}),
          })),
        }
      : {}),
    ...(ingresso.confronti ? { confronti: ingresso.confronti } : {}),
    cronologia:
      ingresso.verifica?.stato === 'fatta' ? [{ quando: creato, iou: ingresso.verifica.iou, parametri: {} }] : [],
  };
  const base = percorsoMaschera(ingresso.schedaParte.parte.id).replace(/\.maschera\.png$/u, '');
  const materiali = materialiPerPezzo(piano.famiglia, piano.parametri).filter(
    (voce) => findPieceMaterial(voce.material) !== undefined,
  );
  const files: Record<string, FileProgetto> = {
    'main.ts': { content: testo(piano.main) },
    [percorsoRiconoscimento]: { content: testo(serializzaRecordRiconoscimento(record)) },
    [`${base}.${estensioni[ingresso.immagine.tipo] ?? 'png'}`]: { content: ingresso.immagine.bytes },
    ...(ingresso.maschera ? { [percorsoMaschera(ingresso.schedaParte.parte.id)]: { content: ingresso.maschera } } : {}),
    ...Object.fromEntries(
      viste.map((vista) => [percorsoVista(idParte, vista.ruolo, vista.tipo), { content: vista.bytes }]),
    ),
    ...(materiali.length > 0
      ? {
          [workbenchPaths.entries]: {
            content: testo(
              workbenchRecords.entries.serialize({
                version: 1,
                entries: { 'main.ts': { components: { hidden: [], isolated: [], opacity: [], materials: materiali } } },
              }),
            ),
          },
        }
      : {}),
  };
  const nome = ingresso.schedaParte.parte.etichetta.trim() || ingresso.schedaParte.parte.nome.trim() || piano.famiglia;
  return { files, record, piano, nome: nome.slice(0, 80) };
}
