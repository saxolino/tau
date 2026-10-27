import type { RJSFSchema } from '@rjsf/utils';
import { famiglie } from '@taucad/smlib/famiglie';
import type {
  DefinizioneParametro,
  Esito,
  FamigliaQualsiasi,
  IdFamiglia,
  ParametriAnnidati,
  UnitaParametro,
  ValoreParametro,
} from '@taucad/smlib/famiglie';
import { manualBoundsSchema } from '@taucad/smlib/manual-operations';
import { materialeFamiglia, provaMateriale } from '@taucad/smlib/varianti';
import type { Correzione, Differenza, Modifica } from '@taucad/smlib/varianti';
import type { GeometryComponentNode } from '@taucad/types';
import type { PieceMaterialChoice } from '@taucad/viewer/cad/piece-materials';
import type { Language } from '#i18n/language.js';
import { bindTranslate, formatNumber, translate } from '#i18n/translate.js';
import type { MessageKey, PlainMessageKey } from '#i18n/translate.js';
import { assumptionState, parameterAssumption, readablePieceName } from '#lib/piece-measures.js';
import { modelWeight } from '#lib/piece-weight.js';
import type { assistantMessages } from '#i18n/messages/assistant.js';

/**
 * What the assistant says first about an open model (SinopiaCAD D4, Fable 26 ott §2.3): a card, not a greeting. The
 * family and variant, three or four key measures, material and weight, the silhouette match and the open assumptions,
 * what to check, and three next steps derived from the family and its state. Pure: the hook gathers, this words.
 */

/** The family a project was built from, as its `main.ts` declares it (`export const famiglia = {…}`). */
export type FamigliaProgetto = Readonly<{ id: IdFamiglia; versione: number; variante: string }>;

const famigliaDichiarata =
  /export\s+const\s+famiglia\s*=\s*\{\s*id:\s*'([a-z_]+)',\s*versione:\s*(\d+),\s*variante:\s*'([a-z_]+)'\s*\}/u;

/**
 * Read the family a recipe project declares. Only the line `emettiMainFamiglia` writes is trusted: a model the agent
 * wrote freely has none, and is a free piece.
 *
 * @param testo - The project's `main.ts`.
 * @returns The family, or undefined for a free model or an unknown family.
 */
export function famigliaDalMain(testo: string): FamigliaProgetto | undefined {
  const trovata = famigliaDichiarata.exec(testo);
  if (!trovata) {
    return undefined;
  }
  const [, id, versione, variante] = trovata;
  const famiglia = famiglie[id as IdFamiglia];
  return famiglia?.varianti.includes(variante!)
    ? { id: famiglia.id, versione: Number(versione), variante: variante! }
    : undefined;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The values the model is built with: the recipe's defaults under the designer's values from `.tau/parameters/`.
 *
 * @param predefiniti - The manifest's defaults.
 * @param valori - The active group's values.
 * @returns A merged copy.
 */
export function parametriEffettivi(predefiniti: unknown, valori: unknown): Record<string, unknown> {
  const risultato: Record<string, unknown> = isRecord(predefiniti) ? structuredClone(predefiniti) : {};
  if (!isRecord(valori)) {
    return risultato;
  }
  for (const [chiave, valore] of Object.entries(valori)) {
    risultato[chiave] =
      isRecord(valore) && isRecord(risultato[chiave]) ? parametriEffettivi(risultato[chiave], valore) : valore;
  }
  return risultato;
}

/**
 * The dotted paths of the leaves of a nested object: the values the designer fixed.
 *
 * @param valori - The active group's values.
 * @param prefisso - The path walked so far.
 * @returns `telaio.sezioneLarghezza`…
 */
export function chiaviFoglia(valori: unknown, prefisso = ''): string[] {
  if (!isRecord(valori)) {
    return prefisso === '' ? [] : [prefisso];
  }
  return Object.entries(valori).flatMap(([chiave, valore]) =>
    chiaviFoglia(valore, prefisso === '' ? chiave : `${prefisso}.${chiave}`),
  );
}

const valoreA = (valori: unknown, percorso: readonly string[]): unknown => {
  let corrente = valori;
  for (const parte of percorso) {
    if (!isRecord(corrente)) {
      return undefined;
    }
    corrente = corrente[parte];
  }
  return corrente;
};

/**
 * How many assumptions are still open: measures whose description carries the assumption marker, still at the
 * recipe's value (a value the designer fixed is no longer an assumption), estimated or assumed.
 *
 * @param schema - The parameters' JSON schema (the manifest's legacy projection).
 * @param valori - The active group's values.
 * @returns The count.
 */
export function ipotesiAperte(schema: RJSFSchema | undefined, valori: unknown): number {
  const conta = (nodo: RJSFSchema | undefined, percorso: readonly string[]): number => {
    const proprieta = nodo?.properties;
    if (!proprieta || Object.keys(proprieta).length === 0) {
      const fissato = valoreA(valori, percorso) !== undefined;
      return !fissato && percorso.length > 0 && assumptionState(parameterAssumption(schema, percorso)) !== undefined
        ? 1
        : 0;
    }
    return Object.entries(proprieta).reduce(
      (somma, [chiave, figlio]) => somma + (typeof figlio === 'object' ? conta(figlio, [...percorso, chiave]) : 0),
      0,
    );
  };
  return conta(schema, []);
}

/**
 * The model's size over all its pieces, in millimetres (X, Y, Z), from the exact SMLib bounds or the glTF ones.
 *
 * @param pieces - The model's pieces.
 * @returns The size, or undefined without bounds.
 */
export function ingombroModello(
  pieces: readonly GeometryComponentNode[],
): readonly [number, number, number] | undefined {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const node of pieces) {
    const esatti = manualBoundsSchema.safeParse(node.extras?.['manualBounds']);
    // The glTF frame is Y-up in metres: its Z is the model's depth and its Y the height.
    const limiti = esatti.success
      ? esatti.data
      : node.bounds
        ? {
            min: [node.bounds.min[0] * 1000, -node.bounds.max[2] * 1000, node.bounds.min[1] * 1000],
            max: [node.bounds.max[0] * 1000, -node.bounds.min[2] * 1000, node.bounds.max[1] * 1000],
          }
        : undefined;
    if (!limiti) {
      continue;
    }
    for (let asse = 0; asse < 3; asse++) {
      min[asse] = Math.min(min[asse]!, limiti.min[asse]!);
      max[asse] = Math.max(max[asse]!, limiti.max[asse]!);
    }
  }
  return Number.isFinite(min[0]) ? [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!] : undefined;
}

/** A message key looked up by data (a family, a parameter, a material), or undefined when the catalog has none. */
const testoOpzionale = (language: Language, key: string): string | undefined => {
  const testo = translate(language, key as PlainMessageKey);
  return testo === key ? undefined : testo;
};

const maiuscola = (testo: string): string => testo.charAt(0).toLocaleUpperCase() + testo.slice(1);

/**
 * A family parameter's name as a pattern maker says it («Larghezza sezione»); the readable key when unnamed.
 *
 * @param famiglia - The family id.
 * @param chiave - The dotted parameter path.
 * @param language - The language.
 * @returns The name.
 */
export function etichettaParametro(famiglia: string, chiave: string, language: Language): string {
  return (
    testoOpzionale(language, `assistant.params.${famiglia}.${chiave}`) ??
    chiave
      .split('.')
      .map((parte) => readablePieceName(parte, language))
      .join(' · ')
  );
}

/**
 * A material key of the families («argento_925») in words.
 *
 * @param materiale - The key.
 * @param language - The language.
 * @returns The name, lower case as it sits in a sentence.
 */
export function nomeMateriale(materiale: string, language: Language): string {
  return testoOpzionale(language, `assistant.materials.${materiale}`) ?? materiale.replaceAll('_', ' ');
}

const numero = (valore: number, language: Language): string =>
  formatNumber(valore, language, { maximumFractionDigits: 2 });

/**
 * A parameter value in words and numbers: «2,4 mm», «1,5°», «6», «sì», «piatto», «argento 925».
 *
 * @param valore - The value.
 * @param unita - Its unit.
 * @param language - The language.
 * @returns The text.
 */
export function testoValore(valore: ValoreParametro, unita: UnitaParametro, language: Language): string {
  if (typeof valore === 'number') {
    return unita === 'mm'
      ? `${numero(valore, language)} mm`
      : unita === 'deg'
        ? `${numero(valore, language)}°`
        : numero(valore, language);
  }
  if (typeof valore === 'boolean') {
    return translate(language, valore ? 'assistant.values.yes' : 'assistant.values.no');
  }
  if (typeof valore === 'string') {
    return (
      testoOpzionale(language, `assistant.values.${valore}`) ??
      testoOpzionale(language, `assistant.materials.${valore}`) ??
      valore.replaceAll('_', ' ')
    );
  }
  return '—';
}

/** One row of a change: the parameter, before → after. */
export type RigaModifica = Readonly<{ id: string; etichetta: string; prima: string; dopo: string }>;

/**
 * A change or a difference in a pattern maker's words.
 *
 * @param famiglia - The family.
 * @param modifica - The parameter, before and after.
 * @param language - The language.
 * @returns The row.
 */
export function rigaModifica(
  famiglia: FamigliaQualsiasi,
  modifica: Modifica | Differenza,
  language: Language,
): RigaModifica {
  const unita =
    'unita' in modifica
      ? modifica.unita
      : (famiglia.parametri.find((voce) => voce.chiave === modifica.chiave)?.unita ?? 'mm');
  return {
    id: modifica.chiave,
    etichetta: etichettaParametro(famiglia.id, modifica.chiave, language),
    prima: testoValore(modifica.prima, unita, language),
    dopo: testoValore(modifica.dopo, unita, language),
  };
}

/** A key measure of a family: its label and the parameters it shows, joined by «×». */
type MisuraChiave = Readonly<{
  etichetta: keyof (typeof assistantMessages)['it']['measures'];
  chiavi: readonly string[];
  diametro?: boolean;
  senzaUnita?: boolean;
}>;

const misureChiave: Readonly<Record<IdFamiglia, readonly MisuraChiave[]>> = {
  fibbia: [
    { etichetta: 'luce', chiavi: ['telaio.luce'] },
    { etichetta: 'apertura', chiavi: ['telaio.altezzaInterna'] },
    { etichetta: 'sezione', chiavi: ['telaio.sezioneLarghezza', 'telaio.sezioneSpessore'] },
  ],
  tacco: [
    { etichetta: 'altezza', chiavi: ['tacco.altezza'] },
    { etichetta: 'seduta', chiavi: ['seduta.lunghezza', 'seduta.larghezza'] },
    { etichetta: 'tappo', chiavi: ['tappo.lunghezza', 'tappo.larghezza'] },
  ],
  placca: [
    { etichetta: 'misure', chiavi: ['piastra.lunghezza', 'piastra.larghezza'] },
    { etichetta: 'spessore', chiavi: ['piastra.spessore'] },
  ],
  occhiello: [
    { etichetta: 'foro', chiavi: ['foro.diametro'], diametro: true },
    { etichetta: 'flangia', chiavi: ['flangia.diametro'], diametro: true },
    { etichetta: 'altezza', chiavi: ['gambo.altezza'] },
  ],
  borchia: [
    { etichetta: 'testa', chiavi: ['testa.diametro'], diametro: true },
    { etichetta: 'altezza', chiavi: ['testa.altezza'] },
    { etichetta: 'gambo', chiavi: ['gambo.diametro', 'gambo.lunghezza'] },
  ],
  anello: [
    { etichetta: 'taglia', chiavi: ['taglia.valore'], senzaUnita: true },
    { etichetta: 'gambo', chiavi: ['gambo.larghezza', 'gambo.spessore'] },
    { etichetta: 'pietra', chiavi: ['pietra.diametro'], diametro: true },
  ],
  fondo_semplice: [
    { etichetta: 'taglia', chiavi: ['pianta.taglia'], senzaUnita: true },
    { etichetta: 'spessori', chiavi: ['spessore.punta', 'spessore.tallone'] },
  ],
  pendente: [
    { etichetta: 'misure', chiavi: ['corpo.lunghezza', 'corpo.larghezza'] },
    { etichetta: 'spessore', chiavi: ['corpo.spessore'] },
  ],
  puntale: [
    { etichetta: 'misure', chiavi: ['puntale.lunghezza', 'puntale.larghezza', 'puntale.altezza'] },
    { etichetta: 'lamiera', chiavi: ['puntale.spessore'] },
  ],
};

const valoreDefinizione = (
  definizione: DefinizioneParametro | undefined,
  p: ParametriAnnidati,
  chiave: string,
): unknown => (definizione?.derivato ? definizione.derivato(p) : valoreA(p, chiave.split('.')));

/**
 * The family's three or four key measures, read from the model's values (derived ones computed): «Luce 21 mm»,
 * «Sezione 3 × 2,5 mm», «Taglia IT 14 · Ø 17,19 mm».
 *
 * @param famiglia - The family.
 * @param p - The model's values, normalised.
 * @param language - The language.
 * @returns Label and value of each.
 */
export function misureChiaveFamiglia(
  famiglia: FamigliaQualsiasi,
  p: ParametriAnnidati,
  language: Language,
): Array<{ etichetta: string; valore: string }> {
  const definizioni = new Map(famiglia.parametri.map((definizione) => [definizione.chiave, definizione]));
  return misureChiave[famiglia.id].flatMap((misura) => {
    const numeri = misura.chiavi.map((chiave) => valoreDefinizione(definizioni.get(chiave), p, chiave));
    if (!numeri.every((valore): valore is number => typeof valore === 'number')) {
      return [];
    }
    let valore = numeri.map((n) => numero(n, language)).join(' × ');
    if (misura.diametro) {
      valore = `Ø ${valore}`;
    }
    if (!misura.senzaUnita) {
      valore = `${valore} mm`;
    }
    if (famiglia.id === 'anello' && misura.etichetta === 'taglia') {
      const sistema = valoreA(p, ['taglia', 'sistema']);
      const diametro = valoreDefinizione(definizioni.get('taglia.diametroInterno'), p, 'taglia.diametroInterno');
      valore = `${typeof sistema === 'string' ? `${sistema.toUpperCase()} ` : ''}${valore}${typeof diametro === 'number' ? ` · Ø ${numero(diametro, language)} mm` : ''}`;
    }
    return [{ etichetta: translate(language, `assistant.measures.${misura.etichetta}`), valore }];
  });
}

/**
 * A check outcome in the designer's words: «Telaio: parete 1 mm, minimo 1,2 mm»; the recipe's own sentence when the
 * outcome has no measure.
 *
 * @param esito - The outcome.
 * @param language - The language.
 * @returns The line.
 */
export function rigaEsito(esito: Esito, language: Language): string {
  const cosa = testoOpzionale(language, `assistant.checks.names.${esito.codice}`);
  if (cosa === undefined || esito.valore === undefined || esito.soglia === undefined) {
    return esito.messaggio;
  }
  const parametri = { what: cosa, value: numero(esito.valore, language), threshold: numero(esito.soglia, language) };
  return esito.pezzo
    ? translate(language, 'assistant.checks.line', { ...parametri, piece: readablePieceName(esito.pezzo, language) })
    : translate(language, 'assistant.checks.lineNoPiece', parametri);
}

/** The process a family's piece is made with, for the next step of the trade. */
const processoPredefinito: Readonly<Partial<Record<IdFamiglia, string>>> = {
  anello: 'fusione_cera_persa',
  pendente: 'fusione_cera_persa',
  occhiello: 'tranciatura_lamiera',
  puntale: 'tranciatura_lamiera',
  fondo_semplice: 'stampaggio_iniezione',
};

const processoDi = (famiglia: FamigliaQualsiasi, p: ParametriAnnidati): string | undefined => {
  const dichiarato = valoreA(p, ['costruzione', 'processo']);
  return typeof dichiarato === 'string' ? dichiarato : processoPredefinito[famiglia.id];
};

/**
 * One next step under the card. `modifica` writes the parameters in one history entry and shows «Cosa ho cambiato»;
 * `varianti` opens the variants; `ipotesi` goes to the recognition's questions (or asks the assistant); `scrivi` fills
 * the composer and leaves the sending to the person, as every suggestion of the assistant does.
 */
export type ChipAssistente = Readonly<
  { id: string; testo: string } & (
    | { tipo: 'modifica'; origine: 'correzione' | 'materiale'; titolo: string; modifiche: readonly Modifica[] }
    | { tipo: 'varianti' }
    | { tipo: 'ipotesi'; bozza: string }
    | { tipo: 'scrivi'; bozza: string }
  )
>;

/** What the next steps are derived from. */
export type StatoAssistente = Readonly<{
  famiglia?: Readonly<{ definizione: FamigliaQualsiasi; variante: string; parametri: ParametriAnnidati }>;
  /** Corrections the variants worker checked: each removes its outcome without raising another. */
  correzioni: readonly Correzione[];
  esiti: readonly Esito[];
  ipotesi: number;
  language: Language;
}>;

const gravita = (esiti: readonly Esito[], correzione: Correzione): number =>
  esiti.some(
    (esito) =>
      esito.codice === correzione.codice &&
      (esito.pezzo ?? '') === (correzione.pezzo ?? '') &&
      esito.livello === 'blocco',
  )
    ? 0
    : 1;

/**
 * The three next steps, most useful first: the correction of the worst outcome, the open assumptions, the variants,
 * the same piece in another material, the trade's next step. A free model gets the assumptions and the general
 * suggestions. The first is the card's one filled button.
 *
 * @param stato - Family, corrections, outcomes, open assumptions and language.
 * @returns Up to three chips.
 */
export function chipsAssistente(stato: StatoAssistente): ChipAssistente[] {
  const { famiglia, language } = stato;
  const t = bindTranslate(language);
  const chips: ChipAssistente[] = [];
  const [correzione] = stato.correzioni.toSorted((a, b) => gravita(stato.esiti, a) - gravita(stato.esiti, b));
  if (famiglia && correzione) {
    const [prima] = correzione.modifiche;
    const nome =
      testoOpzionale(language, `assistant.checks.names.${correzione.codice}`) ??
      etichettaParametro(famiglia.definizione.id, prima!.chiave, language).toLocaleLowerCase();
    const cosa = testoOpzionale(language, `assistant.checks.targets.${correzione.codice}`) ?? nome;
    const valore = typeof prima?.dopo === 'number' ? numero(prima.dopo, language) : numero(correzione.soglia, language);
    chips.push({
      id: `correzione-${correzione.codice}`,
      tipo: 'modifica',
      origine: 'correzione',
      testo: t('assistant.chips.fix', { what: cosa, value: valore }),
      titolo: t('assistant.change.fix', { what: nome }),
      modifiche: correzione.modifiche,
    });
  }
  if (stato.ipotesi > 0) {
    chips.push({
      id: 'ipotesi',
      tipo: 'ipotesi',
      testo:
        stato.ipotesi === 1
          ? t('assistant.chips.assumptionsOne')
          : t('assistant.chips.assumptions', { count: stato.ipotesi }),
      bozza: t('assistant.chips.assumptionsDraft'),
    });
  }
  if (famiglia) {
    chips.push({ id: 'varianti', tipo: 'varianti', testo: t('assistant.chips.variants') });
    const prova = provaMateriale(famiglia.definizione, famiglia.parametri, { variante: famiglia.variante });
    if (prova) {
      const materiale = nomeMateriale(prova.materiale, language);
      chips.push({
        id: 'materiale',
        tipo: 'modifica',
        origine: 'materiale',
        testo: t('assistant.chips.material', { material: materiale }),
        titolo: t('assistant.change.material', { material: materiale }),
        modifiche: prova.modifiche,
      });
    }
    const processo = processoDi(famiglia.definizione, famiglia.parametri);
    const testo = processo === undefined ? undefined : testoOpzionale(language, `assistant.chips.next.${processo}`);
    const bozza =
      processo === undefined ? undefined : testoOpzionale(language, `assistant.chips.nextDraft.${processo}`);
    if (testo && bozza) {
      chips.push({ id: 'prossimo', tipo: 'scrivi', testo, bozza });
    }
  } else {
    for (const [id, key] of [
      ['pareti', 'inspector.chips.checkWalls'],
      ['descrivi', 'assistant.chips.describe'],
      ['alleggerisci', 'inspector.chips.lighter'],
    ] as const satisfies ReadonlyArray<readonly [string, MessageKey]>) {
      const testo = t(key);
      chips.push({ id, tipo: 'scrivi', testo, bozza: testo });
    }
  }
  return chips.slice(0, 3);
}

/** What the card says about the model, before the checks and the next steps. */
export type SchedaModello = Readonly<{
  titolo: string;
  daFoto: boolean;
  misure: ReadonlyArray<{ etichetta: string; valore: string }>;
  /** Material and weight, size, piece count: the facts in one line each. */
  dettagli: readonly string[];
  /** The recognition's silhouette match and the open assumptions. */
  stato: readonly string[];
}>;

/**
 * The model's card: family and variant (or the project's name for a free model), key measures, material and weight,
 * size, the silhouette match of a recognition and the open assumptions.
 *
 * @param ingresso - Family and values, pieces with their picked materials, recognition, assumptions, name, language.
 * @returns The card's words.
 */
export function schedaModello(
  ingresso: Readonly<{
    famiglia?: Readonly<{ definizione: FamigliaQualsiasi; variante: string; parametri: ParametriAnnidati }>;
    pieces: readonly GeometryComponentNode[];
    materials: Readonly<Record<string, PieceMaterialChoice>>;
    iou?: number;
    daFoto: boolean;
    ipotesi: number;
    nome: string;
    language: Language;
  }>,
): SchedaModello {
  const { famiglia, language } = ingresso;
  const t = bindTranslate(language);
  const titolo = famiglia
    ? t('riconoscimento.title', {
        family: t(`riconoscimento.families.${famiglia.definizione.id}` as PlainMessageKey),
        variant: t(`riconoscimento.variants.${famiglia.variante}` as PlainMessageKey),
      })
    : ingresso.nome;
  const peso = modelWeight(ingresso.pieces, ingresso.materials);
  const materialeScelto = peso?.material === undefined ? undefined : t(`materials.names.${peso.material}`);
  const materialeRicetta = famiglia ? materialeFamiglia(famiglia.definizione, famiglia.parametri) : undefined;
  const materiale =
    materialeScelto ??
    (materialeRicetta === undefined ? undefined : maiuscola(nomeMateriale(materialeRicetta, language)));
  const grammi = peso === undefined ? undefined : t('assistant.brief.weight', { mass: numero(peso.grams, language) });
  const ingombro = ingombroModello(ingresso.pieces);
  const dettagli = [
    [materiale, grammi].filter(Boolean).join(' '),
    ingombro
      ? t('assistant.brief.size', {
          size: ingombro.map((lato) => formatNumber(lato, language, { maximumFractionDigits: 1 })).join(' × '),
        })
      : '',
    famiglia
      ? ''
      : ingresso.pieces.length === 1
        ? t('assistant.brief.piecesOne')
        : t('assistant.brief.pieces', { count: ingresso.pieces.length }),
  ].filter((riga) => riga !== '');
  const stato = [
    ingresso.iou === undefined
      ? ''
      : t('assistant.brief.silhouette', {
          iou: formatNumber(ingresso.iou, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        }),
    ingresso.ipotesi === 0
      ? ''
      : ingresso.ipotesi === 1
        ? t('assistant.brief.assumptionsOne')
        : t('assistant.brief.assumptions', { count: ingresso.ipotesi }),
  ].filter((riga) => riga !== '');
  return {
    titolo,
    daFoto: ingresso.daFoto,
    misure: famiglia ? misureChiaveFamiglia(famiglia.definizione, famiglia.parametri, language) : [],
    dettagli,
    stato,
  };
}
