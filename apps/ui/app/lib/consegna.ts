import type { GeometryComponentNode } from '@taucad/types';
import { materiali } from '@taucad/smlib/famiglie';
import type { Materiale, Processo } from '@taucad/smlib/famiglie';
import type { ControlloProducibilita } from '@taucad/smlib/producibilita';
import type { Ingombro, PezzoConsegna } from '@taucad/smlib/consegna';
import type { PezzoProducibilita } from '#lib/producibilita.js';
import { pieceVolumeMm3 } from '#lib/piece-weight.js';
import type { GlbPieceMaterial } from '#services/project-export-glb.js';

/**
 * The delivery's glue in the interface (E3a): what each piece carries into STEP, GLB, the PDF sheet and the Sinopia
 * handoff (material, process, weight), and the lines the sheet writes. Pure functions: Esporta, «Invia a Sinopia»,
 * «Salva in Libreria» and «Chiedi preventivo» read the same answers.
 */

/** Processes whose pieces are cut flat from a sheet: their DXF is the true-size outline. */
const processiPiani: ReadonlySet<Processo> = new Set(['tranciatura_lamiera', 'taglio_cuoio']);

/** A piece as the delivery describes it. */
export type PezzoDellaConsegna = Readonly<{
  nome: string;
  componentId: string;
  volumeMm3?: number;
  materiale?: Materiale;
  processo?: Processo;
  pietra: boolean;
  /** As the Measures weigh it (the material picked, else the model's density). */
  pesoGrammi?: number;
  /** Cut flat from a sheet, by its process. */
  piano: boolean;
}>;

/**
 * The model's pieces with what the delivery carries: the exact volume of the kernel, the engine material and process
 * the producibility checks use, the weight of the Measures.
 *
 * @param input - The model's pieces, the producibility pieces (absent outside the project), the weight of a piece.
 * @returns The pieces, in model order.
 */
export function pezziDellaConsegna({
  nodi,
  pezziProducibilita,
  peso,
}: Readonly<{
  nodi: readonly GeometryComponentNode[];
  pezziProducibilita: readonly PezzoProducibilita[] | undefined;
  peso: (node: GeometryComponentNode) => number | undefined;
}>): PezzoDellaConsegna[] {
  return nodi.map((node) => {
    const pezzo = pezziProducibilita?.find(({ nome }) => nome === node.name);
    const materiale = pezzo?.materiale === undefined ? undefined : materiali[pezzo.materiale];
    const volumeMm3 = pieceVolumeMm3(node);
    const pesoGrammi = peso(node);
    const pietra = pezzo?.pietra ?? false;
    return {
      nome: node.name,
      componentId: node.id,
      ...(volumeMm3 === undefined ? {} : { volumeMm3 }),
      ...(materiale ? { materiale } : {}),
      ...(pezzo && !pietra ? { processo: pezzo.processo } : {}),
      pietra,
      ...(pesoGrammi === undefined ? {} : { pesoGrammi }),
      piano: pezzo !== undefined && processiPiani.has(pezzo.processo),
    };
  });
}

/**
 * What the delivery worker needs of each piece: name, volume, material, flat by process.
 * @param pezzi - The delivery's pieces.
 * @returns The worker's pieces.
 */
export const pezziPerIlWorker = (pezzi: readonly PezzoDellaConsegna[]): PezzoConsegna[] =>
  pezzi.map((pezzo) => ({
    nome: pezzo.nome,
    ...(pezzo.volumeMm3 === undefined ? {} : { volumeMm3: pezzo.volumeMm3 }),
    ...(pezzo.materiale
      ? { materiale: { chiave: pezzo.materiale.chiave, nome: pezzo.materiale.nome, colore: pezzo.materiale.colore } }
      : {}),
    ...(pezzo.piano ? { piano: true } : {}),
  }));

/**
 * The GLB material of each piece that has one, by piece name.
 * @param pezzi - The delivery's pieces.
 * @returns Name → material, colour, finish and process.
 */
export const materialiGlb = (pezzi: readonly PezzoDellaConsegna[]): Map<string, GlbPieceMaterial> =>
  new Map(
    pezzi.flatMap(
      (pezzo): Array<[string, GlbPieceMaterial]> =>
        pezzo.materiale
          ? [
              [
                pezzo.nome,
                {
                  chiave: pezzo.materiale.chiave,
                  nome: pezzo.materiale.nome,
                  colore: pezzo.materiale.colore,
                  metalness: pezzo.materiale.metalness,
                  roughness: pezzo.materiale.roughness,
                  ...(pezzo.processo === undefined ? {} : { processo: pezzo.processo }),
                },
              ],
            ]
          : [],
    ),
  );

/** The order of the sheet's checks: what blocks production first, then warnings, then what passed. */
const ordineLivelli: Readonly<Record<ControlloProducibilita['livello'], number>> = {
  blocco: 0,
  avviso: 1,
  info: 2,
  ok: 3,
};

/**
 * The sheet's producibility lines: one per check, worst first, for the chosen pieces only.
 *
 * @param input - The checks, how a check is named and valued, the chosen pieces (absent = all).
 * @returns The lines.
 */
export function righeControlli({
  controlli,
  nome,
  valore,
  selezionati,
}: Readonly<{
  controlli: readonly ControlloProducibilita[];
  nome: (controllo: ControlloProducibilita) => string;
  valore: (controllo: ControlloProducibilita) => string | undefined;
  selezionati?: readonly string[];
}>): Array<{ livello: ControlloProducibilita['livello']; testo: string }> {
  return controlli
    .filter((controllo) => !selezionati || controllo.pezzo === undefined || selezionati.includes(controllo.pezzo))
    .toSorted((a, b) => ordineLivelli[a.livello] - ordineLivelli[b.livello])
    .map((controllo) => {
      const misura = valore(controllo);
      const testo = [controllo.pezzo, [nome(controllo), misura].filter(Boolean).join(' — ')].filter(Boolean).join(': ');
      return { livello: controllo.livello, testo };
    });
}

/**
 * The sheet's main dimensions: per piece, the key value of the Measures (`40 × 20 mm`, `⌀ 6 mm`) and the overall size
 * read from the solid.
 *
 * @param input - The drawn pieces with their size, the key value of each piece, the words and the number format.
 * @returns One line per piece.
 */
export function righeMisure({
  pezzi,
  valoreChiave,
  ingombroParola,
  numero,
}: Readonly<{
  pezzi: ReadonlyArray<Readonly<{ nome: string; ingombro: Ingombro }>>;
  valoreChiave: (nome: string) => string;
  ingombroParola: string;
  numero: (valore: number) => string;
}>): string[] {
  return pezzi.map(({ nome, ingombro }) => {
    const chiave = valoreChiave(nome);
    const dimensioni = `${ingombroParola} ${ingombro.map((valore) => numero(valore)).join(' × ')} mm`;
    return `${nome}: ${chiave ? `${chiave} · ` : ''}${dimensioni}`;
  });
}

/**
 * Library width and height of a delivered part (mm): plan view for a flat part, front view otherwise.
 * @param ingombro - Overall size X, Y, Z.
 * @param piano - Whether the part is flat.
 * @returns Width and height.
 */
export const misureLibreria = (ingombro: Ingombro, piano: boolean): { larghezza: number; altezza: number } => ({
  larghezza: Math.round(ingombro[0] * 100) / 100,
  altezza: Math.round((piano ? ingombro[1] : ingombro[2]) * 100) / 100,
});
