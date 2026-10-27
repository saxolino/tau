/* eslint-disable @typescript-eslint/naming-convention -- process, family and material keys are the engine's snake_case ids. */
import type { GeometryComponentNode } from '@taucad/types';
import { materiali, sogliaSformo, soglieProcessi } from '@taucad/smlib/famiglie';
import type { IdFamiglia, Materiale, Processo } from '@taucad/smlib/famiglie';
import type { ControlloProducibilita } from '@taucad/smlib/producibilita';
import type { PieceMaterialChoice, PieceMaterialId } from '@taucad/viewer/cad/piece-materials';
import type {
  ProducibilityFace,
  ProducibilityOverlay,
  ProducibilityPieceOverlay,
} from '@taucad/viewer/graphics/three/react/producibility-overlay.types';
import { isStonePiece } from '#lib/piece-measures.js';

/**
 * The producibility checks' glue in the interface (E1): which process a piece defaults to, which family a project's
 * `main.ts` declares, and what the viewer tints for a check. Pure functions: the inspector, the export gate and the
 * assistant read the same answers.
 */

/** The processes the inspector offers, in the order a designer reads them: jewellery, hardware, shoe parts. */
export const processiProducibilita: readonly Processo[] = [
  'fusione_cera_persa',
  'pressofusione_zama',
  'cnc',
  'stampa_3d_resina',
  'stampa_3d_metallo',
  'stampaggio_iniezione',
  'tranciatura_lamiera',
  'taglio_cuoio',
];

/** The pull directions the inspector offers, in model axes (Z up). */
export const direzioniSformo = { z: [0, 0, 1], x: [1, 0, 0], y: [0, 1, 0] } as const satisfies Record<
  string,
  readonly [number, number, number]
>;

/** One of {@link direzioniSformo}. */
export type DirezioneSformo = keyof typeof direzioniSformo;

/** The engine's material for a material the person picked in the Measures (galvanic finishes weigh as zamak). */
const materialePerScelta: Readonly<Record<PieceMaterialId, string>> = {
  'gold-18k-yellow': 'oro_18kt_giallo',
  'gold-18k-rose': 'oro_18kt_rosa',
  'gold-18k-white': 'oro_18kt_bianco',
  'silver-925': 'argento_925',
  brass: 'ottone',
  zamak: 'zama',
  'stainless-steel': 'inox',
  'palladium-plated': 'zama',
  'gunmetal-plated': 'zama',
  leather: 'cuoio',
  rubber: 'gomma',
  tr: 'tr',
  tpu: 'tpu',
  abs: 'abs',
};

/**
 * The engine's material of a piece: the one the person picked, else the table material whose density the model
 * declares (within 1 %: a family writes the table's own densities).
 *
 * @param node - The piece.
 * @param choice - The material picked in the Measures.
 * @returns A key of the engine's material table, or undefined.
 */
export function materialeDelPezzo(
  node: GeometryComponentNode,
  choice: PieceMaterialChoice | undefined,
): string | undefined {
  if (choice) {
    return materialePerScelta[choice.material];
  }
  const density = node.extras?.['density'];
  if (typeof density !== 'number' || !(density > 0)) {
    return undefined;
  }
  let best: Materiale | undefined;
  for (const candidate of Object.values(materiali)) {
    const gap = Math.abs(candidate.densita - density) / density;
    if (gap < 0.01 && (!best || gap < Math.abs(best.densita - density) / density)) {
      best = candidate;
    }
  }
  return best?.chiave;
}

/**
 * The process a material is usually made with: precious metals and bronze are cast in wax, zamak die cast, brass,
 * steels, light alloys and wood machined, polymers injected, leather cut; a stone has none.
 *
 * @param materiale - A key of the engine's material table.
 * @returns The process, or undefined for an unknown material.
 */
export function processoDelMateriale(materiale: string | undefined): Processo | undefined {
  const voce = materiale === undefined ? undefined : materiali[materiale];
  // A stone is set, not made: it has no process of its own.
  if (!voce || voce.tipo === 'pietra') {
    return undefined;
  }
  if (voce.tipo === 'metallo_prezioso' || voce.chiave === 'bronzo') {
    return 'fusione_cera_persa';
  }
  if (voce.chiave === 'zama') {
    return 'pressofusione_zama';
  }
  if (voce.chiave === 'cuoio') {
    return 'taglio_cuoio';
  }
  return voce.tipo === 'polimero' ? 'stampaggio_iniezione' : 'cnc';
}

/** The family a project's `main.ts` declares, as `emettiMainFamiglia` writes it. */
export type FamigliaDelMain = Readonly<{ id: IdFamiglia; versione: number; variante: string }>;

const dichiarazioneFamiglia =
  /export const famiglia = \{ id: '(?<id>[a-z_]+)', versione: (?<versione>\d+), variante: '(?<variante>[^']*)' \};/u;

/**
 * Read the family a project's main file declares (`export const famiglia = { id, versione, variante }`).
 *
 * @param testo - The main file's source.
 * @returns The family, or undefined for a model that is not built from a family.
 */
export function famigliaDalMain(testo: string): FamigliaDelMain | undefined {
  const trovata = dichiarazioneFamiglia.exec(testo)?.groups;
  if (!trovata?.['id'] || trovata['versione'] === undefined || trovata['variante'] === undefined) {
    return undefined;
  }
  return { id: trovata['id'] as IdFamiglia, versione: Number(trovata['versione']), variante: trovata['variante'] };
}

/** The `costruzione.processo` a family's parameters carry, if any. */
const processoDeiParametri = (parametri: unknown): Processo | undefined => {
  const costruzione =
    typeof parametri === 'object' && parametri !== null
      ? (parametri as Record<string, unknown>)['costruzione']
      : undefined;
  const processo =
    typeof costruzione === 'object' && costruzione !== null
      ? (costruzione as Record<string, unknown>)['processo']
      : undefined;
  return typeof processo === 'string' && processo in soglieProcessi ? (processo as Processo) : undefined;
};

/**
 * The process a piece is checked for until the person picks one: the family's own process for the family's first
 * piece, else the process of its material, else lost-wax casting (SinopiaCAD's first trade).
 *
 * @param input - The piece's engine material, whether it is the family's first piece, the family's parameters.
 * @returns The process.
 */
export function processoPredefinito({
  materiale,
  primoDellaFamiglia,
  parametriFamiglia,
}: Readonly<{ materiale?: string; primoDellaFamiglia?: boolean; parametriFamiglia?: unknown }>): Processo {
  const dellaFamiglia = primoDellaFamiglia ? processoDeiParametri(parametriFamiglia) : undefined;
  return dellaFamiglia ?? processoDelMateriale(materiale) ?? 'fusione_cera_persa';
}

/**
 * Deep-merge the parameters a person changed over the model's defaults, as the kernel evaluates them.
 *
 * @param defaults - The model's default parameters.
 * @param values - The active group's values.
 * @returns The merged parameters.
 */
export function parametriCorrenti(defaults: unknown, values: unknown): unknown {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return values === undefined ? defaults : values;
  }
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) {
    return values;
  }
  const merged: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
    merged[key] = parametriCorrenti(merged[key], value);
  }
  return merged;
}

/** A piece the checks speak about: its name (as in the STEP and the GLB), its component id and how it is checked. */
export type PezzoProducibilita = Readonly<{
  nome: string;
  componentId: string;
  processo: Processo;
  /** Whether the person picked the process (else it is {@link processoPredefinito}). */
  scelto: boolean;
  materiale?: string;
  pietra: boolean;
}>;

/**
 * The pieces to check: every part of the model, with the process the person picked or the default one.
 *
 * @param input - The model's pieces, the materials picked per component id, the processes picked per piece name, the
 *   family's parameters when the model is built from a family.
 * @returns The pieces, in model order.
 */
export function pezziProducibilita({
  nodi,
  materialiScelti,
  processiScelti,
  famiglia,
}: Readonly<{
  nodi: readonly GeometryComponentNode[];
  materialiScelti: Readonly<Record<string, PieceMaterialChoice>>;
  processiScelti: Readonly<Record<string, Processo>>;
  famiglia?: Readonly<{ parametri?: unknown }>;
}>): PezzoProducibilita[] {
  const primo = nodi.find((node) => !isStonePiece(node))?.id;
  return nodi.map((node) => {
    const materiale = materialeDelPezzo(node, materialiScelti[node.id]);
    const pietra = isStonePiece(node) || materiale === 'diamante';
    const scelto = processiScelti[node.name];
    return {
      nome: node.name,
      componentId: node.id,
      processo:
        scelto ??
        processoPredefinito({
          ...(materiale === undefined ? {} : { materiale }),
          primoDellaFamiglia: famiglia !== undefined && node.id === primo,
          ...(famiglia ? { parametriFamiglia: famiglia.parametri } : {}),
        }),
      scelto: scelto !== undefined,
      ...(materiale === undefined ? {} : { materiale }),
      pietra,
    };
  });
}

/**
 * What the viewer tints for one check: the faces it lists, the piece's draft map for draft and undercuts, the whole
 * piece for an open solid. A check about the whole model (no piece) tints nothing.
 *
 * @param input - The check, the pieces, the pull direction and the artifact the faces were measured on.
 * @returns The overlay, or undefined.
 */
export function sovrapposizioneControllo({
  controllo,
  pezzi,
  direzione,
  artifactKey,
}: Readonly<{
  controllo: ControlloProducibilita | undefined;
  pezzi: readonly PezzoProducibilita[];
  direzione: DirezioneSformo;
  artifactKey: string | undefined;
}>): ProducibilityOverlay | undefined {
  const pezzo = controllo?.pezzo === undefined ? undefined : pezzi.find((voce) => voce.nome === controllo.pezzo);
  if (!controllo || !pezzo || controllo.evidenza === undefined) {
    return undefined;
  }
  const faces = (controllo.facce ?? []).map(
    ({ faccia, livello }): ProducibilityFace => ({ faceId: faccia, level: livello === 'blocco' ? 'block' : 'warning' }),
  );
  const minimo = controllo.codice === 'SFORMO' ? controllo.soglia : sogliaSformo(pezzo.processo, pezzo.materiale);
  const piece: ProducibilityPieceOverlay = {
    componentId: pezzo.componentId,
    faces,
    ...(controllo.evidenza === 'pezzo' ? { whole: true } : {}),
    ...(controllo.evidenza === 'sformo' && minimo !== undefined
      ? { draft: { direction: direzioniSformo[direzione], minimum: minimo } }
      : {}),
  };
  return { ...(artifactKey === undefined ? {} : { artifactKey }), pieces: [piece] };
}
