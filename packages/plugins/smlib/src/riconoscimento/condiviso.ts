/**
 * Riconoscimento D2 — la parte CONDIVISA fra il CAD e la funzione `sinopiacad` di Sinopia (rotta `/v1/recognize`).
 *
 * 🔴 Copia byte per byte in Sinopia: `supabase/functions/sinopiacad/riconoscimento/condiviso.ts`, accanto a
 * `contratto.json` (copia di `riconoscimento.contratto.json`). Le due copie sono tenute uguali dalle impronte SHA-256
 * scritte nei test dei due repository (`contratto.test.ts` qui, `recognize.test.ts` là). Per questo il file non importa
 * NULLA (né alias `#…`, né `npm:`, né `Deno.*`): gira identico nel browser, in Node (vitest) e nel runtime Deno.
 *
 * Contiene: la scelta della famiglia dal tipo dichiarato, il prompt del classificatore (sistema + schede delle famiglie
 * + testo dell'utente), la convalida strutturale dell'uscita contro lo schema JSON del contratto, i limiti numerici e
 * di lunghezza che l'uscita strutturata dell'API non può imporre, e la normalizzazione dei parametri sul catalogo.
 *
 * Contratto v3: l'ingresso può portare un `contesto` (proporzioni e visibilità misurate dal CAD, ruoli delle viste
 * generate) e due immagini in più (`immagini.principale`, `immagini.controllo`), numerate da {@link ordineImmagini}.
 * L'uscita non cambia. Senza contesto né viste il prompt è quello della v2, byte per byte.
 */

/** Uno schema JSON (il sottoinsieme che il contratto usa: tipi, enum, const, oggetti, array, anyOf, pattern). @public */
export type SchemaJson = {
  [chiave: string]: unknown;
  type?: string | readonly string[];
  enum?: readonly unknown[];
  const?: unknown;
  properties?: Readonly<Record<string, SchemaJson>>;
  required?: readonly string[];
  additionalProperties?: boolean | SchemaJson;
  items?: SchemaJson | false;
  prefixItems?: readonly SchemaJson[];
  anyOf?: readonly SchemaJson[];
  pattern?: string;
};

/** Un limite che lo schema dell'API non esprime, per percorso (`*` = ogni elemento di un array). @public */
export type LimiteContratto = {
  percorso: string;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  maxLength?: number;
  maxItems?: number;
  minItems?: number;
};

/** Un parametro di una famiglia come lo vedono prompt e normalizzazione (dalle `DefinizioneParametro` del CAD). @public */
export type ParametroCatalogo = {
  chiave: string;
  unita: string;
  min?: number;
  max?: number;
  passo?: number;
  default: unknown;
  valori?: readonly string[];
  critico?: boolean;
  silhouetteSensibile?: boolean;
  derivato?: boolean;
  descrizione?: string;
};

/**
 * Le viste piatte da generare per una famiglia (contratto v3): la principale e i controlli (il primo di serie, gli
 * altri su richiesta), facce di `viste.facce`. Non entrano nel prompt: le usa chi genera le viste.
 * @public
 */
export type VisteOrtogonaliCatalogo = { principale: string; controllo: readonly string[] };

/** Una famiglia parametrica nel catalogo del contratto. @public */
export type FamigliaCatalogo = {
  id: string;
  versione: number;
  varianti: readonly string[];
  partTypes: readonly string[];
  /** Le facce del pezzo che una foto può mostrare, con le parole del mestiere (la camera la calcola il CAD). */
  viste: {
    principale: string;
    facce: ReadonlyArray<{ id: string; descrizione: string }>;
    nomi: Readonly<Record<string, { faccia: string; azimuth: number; elevation: number }>>;
    /** Le viste da generare (v3); per variante quando una variante si guarda diversamente (la zeppa del fondo). */
    ortogonali?: VisteOrtogonaliCatalogo & { varianti?: Readonly<Record<string, VisteOrtogonaliCatalogo>> };
  };
  parametri: readonly ParametroCatalogo[];
};

/**
 * Dove porta un tipo (`part_type` del catalogo o tipo della Libreria). `soloSuggerimento`: il tipo è troppo largo per
 * vincolare la famiglia (un `ornament` è una placca logo ma anche una catena o un fiocco).
 * @public
 */
export type DestinoTipo = { famiglia: string; variante?: string; pezzo?: string; soloSuggerimento?: boolean };

/** Il contratto fra CAD e funzione: schema d'uscita, limiti, catalogo delle famiglie e tabelle dei tipi. @public */
export type ContrattoRiconoscimento = {
  versione: number;
  modello: string;
  schemaUscita: SchemaJson;
  limitiUscita: readonly LimiteContratto[];
  schemaParte: SchemaJson;
  limitiParte: readonly LimiteContratto[];
  /** Lo schema del `contesto` della richiesta (v3) e i suoi limiti: un contesto fuori schema è un 400. */
  schemaContesto: SchemaJson;
  limitiContesto: readonly LimiteContratto[];
  famiglie: readonly FamigliaCatalogo[];
  mappaPartType: Readonly<Record<string, DestinoTipo>>;
  mappaLibreria: Readonly<Record<string, DestinoTipo>>;
};

/** Il tipo dichiarato di una parte e chi lo dichiara. @public */
export type TipoDichiarato = { partType: string; fonte: 'utente' | 'libreria' | 'catalogo' | 'riconosci_parti' };

/** Esito della scelta della famiglia prima del classificatore. @public */
export type VincoloFamiglia = {
  /** `vincolata`: il modello sceglie solo variante e parametri; `suggerita`: può contraddirla; `libera`: sceglie lui. */
  vincolo: 'vincolata' | 'suggerita' | 'libera';
  famiglia?: string;
  variante?: string;
  pezzo?: string;
};

/**
 * La famiglia da un tipo dichiarato (specifica §2.2): con fonte utente, Libreria o catalogo la famiglia è vincolata,
 * da `riconosci-parti` è solo un suggerimento; senza tipo il classificatore sceglie fra tutte.
 * @param tipo - Tipo e fonte, se noti.
 * @param contratto - Le tabelle dei tipi.
 * @returns Vincolo e famiglia.
 * @public
 */
export function risolviFamiglia(
  tipo: TipoDichiarato | undefined,
  contratto: Pick<ContrattoRiconoscimento, 'mappaPartType' | 'mappaLibreria'>,
): VincoloFamiglia {
  if (tipo === undefined) {
    return { vincolo: 'libera' };
  }
  const tabella = tipo.fonte === 'libreria' ? contratto.mappaLibreria : contratto.mappaPartType;
  const destino = Object.hasOwn(tabella, tipo.partType) ? tabella[tipo.partType] : undefined;
  if (destino === undefined) {
    return { vincolo: 'libera' };
  }
  return {
    vincolo: tipo.fonte === 'riconosci_parti' || destino.soloSuggerimento ? 'suggerita' : 'vincolata',
    famiglia: destino.famiglia,
    ...(destino.variante === undefined ? {} : { variante: destino.variante }),
    ...(destino.pezzo === undefined ? {} : { pezzo: destino.pezzo }),
  };
}

/**
 * Le famiglie da descrivere nel prompt: la sola famiglia vincolata, altrimenti tutte quelle del catalogo.
 * @param vincolo - Esito di {@link risolviFamiglia}.
 * @param contratto - Il catalogo.
 * @returns Le schede da mettere nel prompt.
 * @public
 */
export function famiglieDelPrompt(
  vincolo: VincoloFamiglia,
  contratto: Pick<ContrattoRiconoscimento, 'famiglie'>,
): FamigliaCatalogo[] {
  if (vincolo.vincolo === 'vincolata') {
    const sola = contratto.famiglie.find((famiglia) => famiglia.id === vincolo.famiglia);
    if (sola) {
      return [sola];
    }
  }
  return [...contratto.famiglie];
}

// ─── Contesto e immagini della richiesta (v3) ────────────────────────────────────────────────────────────────────

/** Il ruolo di una vista generata. @public */
export type RuoloVista = 'principale' | 'controllo';

/**
 * Il contesto della richiesta (v3), nella forma che il prompt legge: lo schema zod sta nel CAD
 * (`riconoscimento/contesto.ts`), lo schema JSON nel contratto (`schemaContesto`).
 * @public
 */
export type ContestoRichiesta = {
  versione: 1;
  proporzioni?: {
    rapporti: ReadonlyArray<{
      chiave: 'altezza_su_lunghezza' | 'larghezza_su_lunghezza' | 'altezza_su_altezza';
      valore: number;
    }>;
    affidabilita: number;
    parti: number;
  };
  visibilita?: { stato: 'intera' | 'parziale'; motivi: ReadonlyArray<'tagliata_bordo' | 'piccola' | 'coperta'> };
  viste?: ReadonlyArray<{ ruolo: RuoloVista; faccia: string }>;
};

/** Un'immagine della richiesta, per nome della chiave in `immagini`. @public */
export type ImmagineDellaRichiesta = 'ritaglio' | 'intera' | 'principale' | 'controllo' | 'differenza';

/**
 * L'ordine delle immagini nel messaggio, in un posto solo: 1 ritaglio, 2 immagine intera, poi la vista principale, la
 * vista di controllo e, ultima, la differenza del rientro. Il server ordina così i blocchi, il testo dell'utente le
 * numera così.
 * @param presenti - Quali immagini facoltative ci sono.
 * @returns Le chiavi di `immagini` nell'ordine del messaggio.
 * @public
 */
export function ordineImmagini(
  presenti: Readonly<{ principale?: boolean; controllo?: boolean; differenza?: boolean }>,
): ImmagineDellaRichiesta[] {
  return [
    'ritaglio',
    'intera',
    ...(presenti.principale ? (['principale'] as const) : []),
    ...(presenti.controllo ? (['controllo'] as const) : []),
    ...(presenti.differenza ? (['differenza'] as const) : []),
  ];
}

/**
 * Le viste generate e le loro voci nel contesto vanno a coppie: un'immagine senza la sua voce (o una voce senza la sua
 * immagine, o due voci con lo stesso ruolo) è una richiesta sbagliata (400), perché il testo numererebbe immagini che
 * non ci sono.
 * @param presenti - Quali viste sono in `immagini`.
 * @param contesto - Il contesto della richiesta, se c'è.
 * @returns Gli errori, vuoto se le viste e le voci combaciano.
 * @public
 */
export function erroriViste(
  presenti: Readonly<{ principale: boolean; controllo: boolean }>,
  contesto: Pick<ContestoRichiesta, 'viste'> | undefined,
): string[] {
  const voci = contesto?.viste ?? [];
  const errori: string[] = [];
  for (const ruolo of ['principale', 'controllo'] as const) {
    const quante = voci.filter((voce) => voce.ruolo === ruolo).length;
    if (quante > 1) {
      errori.push(`/contesto/viste: «${ruolo}» ripetuta`);
    } else if (presenti[ruolo] && quante === 0) {
      errori.push(`/immagini/${ruolo}: manca la sua voce in contesto.viste`);
    } else if (!presenti[ruolo] && quante === 1) {
      errori.push(`/contesto/viste: «${ruolo}» senza immagine`);
    }
  }
  return errori;
}

/**
 * La versione della risposta: 3 solo a una richiesta che dichiara `versioneContratto: 3`, altrimenti 2, così un CAD
 * vecchio (che accetta 1 o 2) legge una funzione nuova.
 * @param versioneRichiesta - Il campo `versioneContratto` del corpo, com'è arrivato.
 * @returns La versione da scrivere nella risposta.
 * @public
 */
export const versioneRisposta = (versioneRichiesta: unknown): 2 | 3 => (versioneRichiesta === 3 ? 3 : 2);

// ─── Prompt ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** La parte da riconoscere, nel minimo che il prompt usa (sottoinsieme della scheda della parte). @public */
export type ContestoPrompt = {
  etichetta: string;
  nome: string;
  materiale?: string;
  colore?: string;
  verticale: string;
  altreParti: readonly string[];
  tipo?: TipoDichiarato;
  vincolo: VincoloFamiglia;
  scala?: { tipo: string; valoreMm: number; cosa: string; pxPerMm?: number; confidenza: number };
  origineMaschera?: 'sam' | 'contorno';
  /** Pixel del ritaglio (immagine 1) per pixel dell'immagine originale. */
  fattoreRitaglio?: number;
  lingua: 'it' | 'en';
  /** Rientro dopo la verifica D3: c'è un'immagine differenza (rosso = modello, blu = maschera). */
  rientro?: boolean;
  /** V3: le viste generate che seguono le due immagini, nell'ordine di {@link ordineImmagini}. */
  viste?: ContestoRichiesta['viste'];
  /** V3: le proporzioni misurate sulla foto. */
  proporzioni?: ContestoRichiesta['proporzioni'];
  /** V3: se la parte si vede intera. */
  visibilita?: ContestoRichiesta['visibilita'];
};

/** Le opzioni del prompt che non stanno nella scheda della parte. @public */
export type OpzioniPrompt = { lingua: 'it' | 'en'; fattoreRitaglio?: number; rientro?: boolean; contesto?: ContestoRichiesta };

/** Il minimo della scheda della parte da cui nasce il contesto (lo schema completo sta in `scheda-parte.ts`). @public */
export type SchedaParteMinima = {
  progetto: { verticale: string };
  parte: { nome: string; etichetta: string; materiale?: string; colore?: string };
  maschera?: { origine: 'sam' | 'contorno' };
  tipo?: TipoDichiarato;
  scala?: { tipo: string; valoreMm: number; cosa: string; pxPerMm?: number; confidenza: number };
  altreParti?: ReadonlyArray<{ etichetta: string }>;
};

/**
 * Il contesto del prompt da una scheda della parte.
 * @param scheda - La scheda della parte.
 * @param vincolo - Esito di {@link risolviFamiglia}.
 * @param opzioni - Lingua dei motivi, fattore del ritaglio, rientro e, dalla v3, il contesto della richiesta.
 * @returns Il contesto.
 * @public
 */
export function contestoDaSchedaParte(
  scheda: SchedaParteMinima,
  vincolo: VincoloFamiglia,
  opzioni: OpzioniPrompt,
): ContestoPrompt {
  const richiesta = opzioni.contesto;
  return {
    etichetta: scheda.parte.etichetta,
    nome: scheda.parte.nome,
    ...(scheda.parte.materiale === undefined ? {} : { materiale: scheda.parte.materiale }),
    ...(scheda.parte.colore === undefined ? {} : { colore: scheda.parte.colore }),
    verticale: scheda.progetto.verticale,
    altreParti: (scheda.altreParti ?? []).map((parte) => parte.etichetta).slice(0, 20),
    ...(scheda.tipo === undefined ? {} : { tipo: scheda.tipo }),
    vincolo,
    ...(scheda.scala === undefined ? {} : { scala: scheda.scala }),
    ...(scheda.maschera === undefined ? {} : { origineMaschera: scheda.maschera.origine }),
    ...(opzioni.fattoreRitaglio === undefined ? {} : { fattoreRitaglio: opzioni.fattoreRitaglio }),
    lingua: opzioni.lingua,
    ...(opzioni.rientro ? { rientro: true } : {}),
    ...(richiesta?.viste === undefined || richiesta.viste.length === 0 ? {} : { viste: richiesta.viste }),
    ...(richiesta?.proporzioni === undefined || richiesta.proporzioni.rapporti.length === 0
      ? {}
      : { proporzioni: richiesta.proporzioni }),
    ...(richiesta?.visibilita === undefined ? {} : { visibilita: richiesta.visibilita }),
  };
}

/**
 * Il prompt di sistema: ruolo, telaio e viste, regole di scala e di uscita. Stabile (nessun dato della richiesta):
 * con le schede delle famiglie forma il prefisso che la cache del prompt riusa.
 * @returns Il testo.
 * @public
 */
export function promptDiSistema(): string {
  return `You are a senior footwear and leather-goods pattern maker and a goldsmith. From one photo of a single part (with its segmentation mask) you recognise which parametric family the part belongs to and you estimate the numbers of that family's recipe, so that a CAD program can rebuild the part. You never invent precision: every number carries where it comes from and how sure you are.

# Units and frame
Millimetres and degrees. You do NOT work out camera axes: each family sheet lists the FACES of the part that a photo can show, in the words of the trade, and marks the main product face. The code turns your answer into a camera.
- \`vista.faccia\`: the face the photo shows (an id from the sheet of the family you chose). If no listed face is shown squarely, pick the nearest and say so in \`note\`.
- \`vista.azimuth\`, \`vista.elevation\`: how far the photo is from looking STRAIGHT AT that face (0, 0 = straight on). azimuth: camera moved to the RIGHT of the picture (negative = left); elevation: camera raised toward the TOP of the picture (negative = lowered). A three-quarter look is typically azimuth ±25…45 and elevation 15…35. Never put the angles of the part's own axes here.
- \`vista.rollo\`: rotation of the picture plane, degrees, positive counter-clockwise (−45…45).

View names (\`vista.nome\`): fronte = the front of the part, tre_quarti = an oblique look, dietro / fianco_esterno / fianco_interno / sopra / sotto = that face. The family sheet says which face each name means: follow the sheet. \`ortografica\` is true when the photo looks taken from far away or with a long lens (parallel edges stay parallel). \`latiOcclusi\` lists the sides of the picture where the part is hidden by something else (for example the seat of a heel under the shoe).

# Scale (scala), in this order of priority — the first available wins
1. misura_nota: the user typed a measure of the part ("20 mm = larghezza"). The request gives pxPerMm already measured on the mask: use it.
2. libreria / catalogo: dimensions declared by the component library or the supplier catalogue (frontal, no perspective). Use the given pxPerMm.
3. taglia: shoe size, only when the whole shoe is in the picture and the view is a side view: foot length = size × 6.667 + 12 mm.
4. forma: the last of the project (length of the foot), same use as the size.
5. stima: nothing is known — estimate pxPerMm from craft proportions (top lift of a stiletto ≈ 10 mm wide, buckle opening ≈ strap width + 1 mm, typical strap 20 mm, eyelet hole 4–6 mm, stud 6–12 mm). Confidence at most 0.5.
\`scala.pxPerMm\` is in pixels of the ORIGINAL picture per millimetre (the crop in picture 1 is scaled by the factor given in the request). Use null only if you cannot estimate it at all.

# Output rules
1. Numbers in millimetres and degrees, in the family's local frame.
2. Every parameter carries \`fonte\` and \`confidenza\` (0–1) and a short \`motivo\` (≤ 140 characters, in the language the request asks for). Use only parameter keys listed in the family sheet; never output derived parameters. Give \`min\`/\`max\` when you can bound the plausible range seen in the photo.
3. A parameter you cannot see: \`fonte: "non_visibile"\`, value = the craft default of the sheet, confidence at most 0.4.
4. \`domande\` only for CRITICAL parameters with confidence below 0.6, at most 3, most important first; each with exactly three proposals in ascending order, the middle one being your estimate.
5. \`vista.faccia\` is a face id of the chosen family's sheet; \`vista.azimuth\` and \`vista.elevation\` are offsets from the straight look at that face (see above). For \`libero\` and \`non_modellabile\` use \`sopra\`, 0, 0.
6. If the part belongs to none of the families, answer \`famiglia.id: "libero"\` (an agent will write a free recipe); if it is an upper, a lining, a material or anything that is not a rigid modelled part, answer \`"non_modellabile"\`. In both cases leave \`parametri\` and \`domande\` empty.
\`famiglia.alternative\` lists at most two other families you hesitated on, with their confidence. \`materiale.chiave\` is a material key of the sheet's material parameter when one fits. \`note\` is one or two sentences for the designer (≤ 300 characters).`;
}

const numero = (valore: number): string =>
  Number.isInteger(valore) ? String(valore) : String(Number(valore.toFixed(3)));

const intervallo = (parametro: ParametroCatalogo): string => {
  if (parametro.unita === 'enum') {
    return (parametro.valori ?? []).join(' | ');
  }
  if (parametro.unita === 'bool') {
    return 'true | false';
  }
  if (parametro.min === undefined && parametro.max === undefined) {
    return '—';
  }
  return `${parametro.min === undefined ? '…' : numero(parametro.min)}…${parametro.max === undefined ? '…' : numero(parametro.max)}`;
};

const predefinito = (valore: unknown): string =>
  typeof valore === 'number' ? numero(valore) : Array.isArray(valore) ? '(outline)' : JSON.stringify(valore);

/** Le righe delle facce di una famiglia: id, parole del mestiere e che cosa vogliono dire le viste per nome. */
const righeViste = (famiglia: FamigliaCatalogo): string[] => {
  const { principale, facce, nomi } = famiglia.viste;
  return [
    `Faces of this part (\`vista.faccia\`; main product face: ${principale}):`,
    ...facce.map((faccia) => `- ${faccia.id} — ${faccia.descrizione}`),
    `View names here: ${Object.entries(nomi)
      .map(([nome, vista]) => `${nome} = ${vista.faccia}`)
      .join(' · ')}.`,
  ];
};

/**
 * La scheda di una famiglia per il prompt: varianti, tipi e parametri con unità, intervallo, predefinito e bandiere.
 * @param famiglia - La famiglia del catalogo.
 * @returns Il testo della scheda.
 * @public
 */
export function schedaFamigliaTesto(famiglia: FamigliaCatalogo): string {
  const righe = famiglia.parametri
    .filter((parametro) => parametro.unita !== 'contorno')
    .map((parametro) => {
      const bandiere = [
        parametro.derivato ? 'DERIVED (do not output)' : '',
        parametro.critico ? 'CRITICAL' : '',
        parametro.silhouetteSensibile ? 'silhouette' : '',
      ]
        .filter(Boolean)
        .join(', ');
      return `- ${parametro.chiave} — ${parametro.unita} — ${intervallo(parametro)} — default ${predefinito(parametro.default)}${bandiere ? ` — ${bandiere}` : ''}${parametro.descrizione ? ` — ${parametro.descrizione}` : ''}`;
    });
  return [
    `## Family \`${famiglia.id}\` (recipe v${famiglia.versione})`,
    `Variants: ${famiglia.varianti.join(' | ')}`,
    `part_type: ${famiglia.partTypes.length > 0 ? famiglia.partTypes.join(', ') : '— (jewellery and accessories, by shape)'}`,
    ...righeViste(famiglia),
    'Parameters (key — unit — range — default — flags — meaning in Italian):',
    ...righe,
  ].join('\n');
}

/**
 * Le schede delle famiglie in un solo blocco (secondo blocco del sistema, con la cache del prompt).
 * @param famiglie - Le famiglie da descrivere.
 * @returns Il testo.
 * @public
 */
export function schedeFamiglie(famiglie: readonly FamigliaCatalogo[]): string {
  return ['# Family sheets', ...famiglie.map((famiglia) => schedaFamigliaTesto(famiglia))].join('\n\n');
}

const fonteScala: Record<string, string> = {
  misura: 'misura_nota (typed by the user)',
  libreria: 'libreria (component library)',
  catalogo: 'catalogo (supplier catalogue)',
  taglia: 'taglia (shoe size)',
  forma: 'forma (the last)',
};

const nomeRapporto = new Map([
  ['altezza_su_lunghezza', 'part height / product length'],
  ['larghezza_su_lunghezza', 'part width / product length'],
  ['altezza_su_altezza', 'part height / product height'],
]);

const motivoVisibilita = new Map([
  ['tagliata_bordo', 'cut by the picture edge'],
  ['piccola', 'small in the picture'],
  ['coperta', 'partly covered by another part'],
]);

/**
 * Le immagini del messaggio per un contesto del prompt: le viste che nomina e la differenza del rientro.
 * @param contesto - Il contesto del prompt.
 * @returns L'ordine di {@link ordineImmagini}.
 */
const ordineDelContesto = (contesto: ContestoPrompt): ImmagineDellaRichiesta[] =>
  ordineImmagini({
    principale: (contesto.viste ?? []).some((vista) => vista.ruolo === 'principale'),
    controllo: (contesto.viste ?? []).some((vista) => vista.ruolo === 'controllo'),
    differenza: contesto.rientro === true,
  });

/**
 * Le righe v3 sulle viste generate: che cosa mostra ciascuna e come pesarle contro la foto. Vuote senza viste.
 * @param viste - Le viste, in qualunque ordine (si numerano con `numeroDi`).
 * @param numeroDi - Il numero dell'immagine di un ruolo nel messaggio.
 * @returns Le righe.
 */
const righeVisteGenerate = (
  viste: ContestoPrompt['viste'],
  numeroDi: (ruolo: RuoloVista) => number,
): string[] => {
  if (viste === undefined || viste.length === 0) {
    return [];
  }
  const ordinate = [...viste].sort((a, b) => numeroDi(a.ruolo) - numeroDi(b.ruolo));
  const principale = viste.some((vista) => vista.ruolo === 'principale');
  const controllo = viste.some((vista) => vista.ruolo === 'controllo');
  return [
    ...ordinate.map(
      (vista) =>
        `Picture ${numeroDi(vista.ruolo)}: the ${vista.ruolo === 'principale' ? 'MAIN' : 'CONTROL'} VIEW — a flat orthographic picture of the part alone, GENERATED from picture 1 by an image model, looking straight at the face \`${vista.faccia}\`.`,
    ),
    principale && controllo
      ? 'Read profiles and ratios from the main view, thicknesses and depths from the control view.'
      : principale
        ? 'Read profiles and ratios from the main view.'
        : 'Read thicknesses and depths from the control view.',
    'Picture 1 (the photo) decides what exists and the materials: where a generated view contradicts the photo, the photo wins and your confidence goes down.',
    '`vista.*` always describes picture 1 (the photo), never a generated view.',
  ];
};

/**
 * Le righe v3 sulle proporzioni e sulla visibilità misurate dal CAD. Vuote senza contesto.
 * @param contesto - Il contesto del prompt.
 * @returns Le righe.
 */
const righeMisureFoto = (contesto: ContestoPrompt): string[] => {
  const righe: string[] = [];
  const { proporzioni, visibilita } = contesto;
  if (proporzioni !== undefined) {
    righe.push(
      `Proportions measured on the photo, without perspective correction (reliability ${numero(proporzioni.affidabilita)}; the product is the union of ${proporzioni.parti} part boxes): ${proporzioni.rapporti
        .map((rapporto) => `${nomeRapporto.get(rapporto.chiave) ?? rapporto.chiave} = ${numero(rapporto.valore)}`)
        .join('; ')}. Use them only where nothing better is readable, with \`fonte: "proporzione"\`; a low reliability means a perspective or a partial framing.`,
    );
  }
  if (visibilita?.stato === 'parziale') {
    righe.push(
      `The part is only partly visible in the photo (${visibilita.motivi.map((motivo) => motivoVisibilita.get(motivo) ?? motivo).join(', ') || 'partial'}): what cannot be seen stays a hypothesis, with a low confidence.`,
    );
  } else if (visibilita?.stato === 'intera') {
    righe.push('The part is whole in the photo.');
  }
  return righe;
};

/**
 * Il testo dell'utente: la parte, il tipo e il vincolo, la scala nota e come leggere le immagini. Dalla v3 anche le
 * viste generate, le proporzioni e la visibilità, solo se ci sono: senza, il testo è quello della v2.
 * @param contesto - Il contesto della richiesta.
 * @returns Il testo (dopo le immagini nel messaggio).
 * @public
 */
export function testoUtente(contesto: ContestoPrompt): string {
  const ordine = ordineDelContesto(contesto);
  const numeroDi = (immagine: ImmagineDellaRichiesta): number => ordine.indexOf(immagine) + 1;
  const parte = [
    `Part to recognise: «${contesto.etichetta}» (name: ${contesto.nome}`,
    contesto.materiale ? `; material: ${contesto.materiale}` : '',
    contesto.colore ? `; colour: ${contesto.colore}` : '',
    ').',
  ].join('');
  const tipo =
    contesto.vincolo.vincolo === 'vincolata'
      ? `Declared type: ${contesto.tipo?.partType ?? '—'} (source: ${contesto.tipo?.fonte ?? '—'}). The family is FIXED: \`${contesto.vincolo.famiglia}\`${contesto.vincolo.pezzo ? ` (only the piece «${contesto.vincolo.pezzo}»)` : ''} — choose only variant, view, scale and parameters.`
      : contesto.vincolo.vincolo === 'suggerita'
        ? `Suggested type: ${contesto.tipo?.partType ?? '—'} (from an automatic part analysis) → family \`${contesto.vincolo.famiglia}\` is a suggestion: contradict it if the picture says otherwise.`
        : 'No declared type: choose the family yourself.';
  const scala =
    contesto.scala === undefined
      ? 'No known scale: estimate it (fonte "stima").'
      : `Known scale: ${numero(contesto.scala.valoreMm)} mm = ${contesto.scala.cosa} (source: ${fonteScala[contesto.scala.tipo] ?? contesto.scala.tipo}, confidence ${numero(contesto.scala.confidenza)})${
          contesto.scala.pxPerMm === undefined
            ? '.'
            : `; measured on the mask: ${numero(contesto.scala.pxPerMm)} px/mm in the original picture${
                contesto.fattoreRitaglio === undefined
                  ? ''
                  : ` (≈ ${numero(contesto.scala.pxPerMm * contesto.fattoreRitaglio)} px/mm in picture 1)`
              }.`
        }`;
  const maschera =
    contesto.origineMaschera === 'contorno'
      ? 'The mask was rasterised from an approximate outline: its edge can be off by a few pixels.'
      : 'The mask is a precise segmentation.';
  return [
    parte,
    `Vertical: ${contesto.verticale}. Other parts in the picture: ${contesto.altreParti.length > 0 ? contesto.altreParti.join(', ') : 'none listed'}.`,
    tipo,
    scala,
    maschera,
    `Picture 1: the part cropped (its box + 15 %), long side 1024 px, the mask outline drawn in red.${contesto.fattoreRitaglio === undefined ? '' : ` Scale factor of the crop: ${numero(contesto.fattoreRitaglio)} crop px per original px.`} Picture 2: the whole picture reduced to 512 px, the part's box highlighted.`,
    ...righeVisteGenerate(contesto.viste, numeroDi),
    ...righeMisureFoto(contesto),
    contesto.rientro
      ? `Picture ${numeroDi('differenza')}: the silhouette of the model built from your previous answer (red) over the mask (blue) does not match: is the family, the variant or the view wrong? Answer again from scratch.`
      : '',
    `Write \`motivo\`, \`domande.motivo\` and \`note\` in ${contesto.lingua === 'it' ? 'Italian' : 'English'}.`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Il prompt completo: i blocchi di sistema (stabili, con la cache sull'ultimo) e il testo dell'utente. @public */
export type PromptRiconoscimento = { sistema: [string, string]; utente: string; famiglie: string[] };

/**
 * Il prompt del classificatore per una scheda della parte: regole, schede delle famiglie ammesse, testo dell'utente.
 * @param scheda - La scheda della parte.
 * @param contratto - Catalogo e tabelle dei tipi.
 * @param opzioni - Lingua dei motivi, fattore del ritaglio, rientro dopo la verifica e, dalla v3, il contesto (viste
 *   generate, proporzioni, visibilità). Il sistema non cambia mai: la cache del prompt resta.
 * @returns Il prompt e le famiglie descritte.
 * @public
 */
export function promptRiconoscimento(
  scheda: SchedaParteMinima,
  contratto: Pick<ContrattoRiconoscimento, 'famiglie' | 'mappaPartType' | 'mappaLibreria'>,
  opzioni: OpzioniPrompt,
): PromptRiconoscimento {
  const vincolo = risolviFamiglia(scheda.tipo, contratto);
  const famiglie = famiglieDelPrompt(vincolo, contratto);
  return {
    sistema: [promptDiSistema(), schedeFamiglie(famiglie)],
    utente: testoUtente(contestoDaSchedaParte(scheda, vincolo, opzioni)),
    famiglie: famiglie.map((famiglia) => famiglia.id),
  };
}

// ─── Convalida ───────────────────────────────────────────────────────────────────────────────────────────────────

const isRecord = (valore: unknown): valore is Record<string, unknown> =>
  typeof valore === 'object' && valore !== null && !Array.isArray(valore);

const tipoDi = (valore: unknown): string =>
  valore === null
    ? 'null'
    : Array.isArray(valore)
      ? 'array'
      : typeof valore === 'number'
        ? Number.isInteger(valore)
          ? 'integer'
          : 'number'
        : typeof valore;

const tipoAmmesso = (valore: unknown, tipo: string): boolean => {
  const reale = tipoDi(valore);
  if (tipo === 'number') {
    return (reale === 'number' || reale === 'integer') && Number.isFinite(valore as number);
  }
  return reale === tipo;
};

/**
 * Convalida strutturale contro uno schema JSON del contratto: tipi, enum, const, campi richiesti, campi in più, array,
 * tuple (`prefixItems`), `anyOf` e `pattern`. I limiti numerici e di lunghezza sono a parte ({@link applicaLimiti}).
 * @param valore - Il documento.
 * @param schema - Lo schema.
 * @param percorso - Il puntatore del documento (per i messaggi).
 * @returns Gli errori, vuoto se il documento è conforme.
 * @public
 */
export function convalidaStruttura(valore: unknown, schema: SchemaJson, percorso = ''): string[] {
  const dove = percorso || '/';
  if (schema.anyOf) {
    const rami = schema.anyOf.map((ramo) => convalidaStruttura(valore, ramo, percorso));
    return rami.some((errori) => errori.length === 0) ? [] : [`${dove}: nessuna alternativa ammessa`];
  }
  if (schema.const !== undefined && valore !== schema.const) {
    return [`${dove}: atteso ${JSON.stringify(schema.const)}`];
  }
  if (schema.enum && !schema.enum.includes(valore)) {
    return [`${dove}: valore fuori elenco`];
  }
  if (schema.type !== undefined) {
    const tipi = typeof schema.type === 'string' ? [schema.type] : schema.type;
    if (!tipi.some((tipo) => tipoAmmesso(valore, tipo))) {
      return [`${dove}: atteso ${tipi.join('|')}, trovato ${tipoDi(valore)}`];
    }
  }
  if (typeof valore === 'string' && schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(valore)) {
    return [`${dove}: formato non valido`];
  }
  const errori: string[] = [];
  if (isRecord(valore)) {
    const proprieta = schema.properties ?? {};
    for (const richiesto of schema.required ?? []) {
      if (!Object.hasOwn(valore, richiesto)) {
        errori.push(`${percorso}/${richiesto}: mancante`);
      }
    }
    for (const [chiave, figlio] of Object.entries(valore)) {
      const sotto = Object.hasOwn(proprieta, chiave) ? proprieta[chiave] : undefined;
      if (sotto === undefined) {
        if (schema.additionalProperties === false) {
          errori.push(`${percorso}/${chiave}: campo non previsto`);
        }
        continue;
      }
      errori.push(...convalidaStruttura(figlio, sotto, `${percorso}/${chiave}`));
    }
  }
  if (Array.isArray(valore)) {
    if (schema.prefixItems) {
      if (valore.length !== schema.prefixItems.length) {
        errori.push(`${dove}: attesi ${schema.prefixItems.length} elementi`);
      }
      for (const [indice, elemento] of valore.slice(0, schema.prefixItems.length).entries()) {
        errori.push(...convalidaStruttura(elemento, schema.prefixItems[indice]!, `${percorso}/${indice}`));
      }
    } else if (schema.items && typeof schema.items === 'object') {
      for (const [indice, elemento] of valore.entries()) {
        errori.push(...convalidaStruttura(elemento, schema.items, `${percorso}/${indice}`));
      }
    }
  }
  return errori.slice(0, 20);
}

const corrisponde = (modello: readonly string[], segmenti: readonly string[]): boolean =>
  modello.length === segmenti.length && modello.every((parte, indice) => parte === '*' || parte === segmenti[indice]);

/** Esito di {@link applicaLimiti}: il documento corretto, le correzioni fatte e gli errori non correggibili. @public */
export type EsitoLimiti<T> = { valore: T; correzioni: string[]; errori: string[] };

/**
 * Applica i limiti del contratto: con `correggi` i numeri tornano nell'intervallo, i testi si accorciano, gli array
 * troppo lunghi si tagliano, un numero che doveva superare `exclusiveMinimum` diventa `null` (nel contratto succede
 * solo a `scala.pxPerMm`, che ammette null) (uscita del modello); senza, ogni violazione è un errore (ingresso del
 * client). `minLength` e `minItems` violati sono sempre errori.
 * @param valore - Il documento (non modificato).
 * @param limiti - I limiti del contratto.
 * @param correggi - Correggere invece di rifiutare.
 * @returns Una copia corretta, le correzioni e gli errori.
 * @public
 */
export function applicaLimiti<T>(valore: T, limiti: readonly LimiteContratto[], correggi: boolean): EsitoLimiti<T> {
  const copia = structuredClone(valore);
  const correzioni: string[] = [];
  const errori: string[] = [];
  const modelli = limiti.map((limite) => ({ limite, segmenti: limite.percorso.split('/').slice(1) }));
  const visita = (nodo: unknown, segmenti: string[], imposta: (nuovo: unknown) => void): void => {
    const dove = `/${segmenti.join('/')}`;
    for (const { limite, segmenti: modello } of modelli) {
      if (!corrisponde(modello, segmenti)) {
        continue;
      }
      if (typeof nodo === 'number') {
        if (limite.exclusiveMinimum !== undefined && !(nodo > limite.exclusiveMinimum)) {
          if (correggi) {
            imposta(null);
            correzioni.push(dove);
          } else {
            errori.push(`${dove}: deve superare ${limite.exclusiveMinimum}`);
          }
          continue;
        }
        const basso = limite.minimum !== undefined && nodo < limite.minimum;
        const alto = limite.maximum !== undefined && nodo > limite.maximum;
        if (basso || alto) {
          if (correggi) {
            imposta(basso ? limite.minimum : limite.maximum);
            correzioni.push(dove);
          } else {
            errori.push(`${dove}: fuori intervallo`);
          }
        }
      } else if (typeof nodo === 'string' && limite.minLength !== undefined && nodo.length < limite.minLength) {
        errori.push(`${dove}: troppo corto`);
      } else if (typeof nodo === 'string' && limite.maxLength !== undefined && nodo.length > limite.maxLength) {
        if (correggi) {
          imposta(nodo.slice(0, limite.maxLength));
          correzioni.push(dove);
        } else {
          errori.push(`${dove}: troppo lungo`);
        }
      } else if (Array.isArray(nodo)) {
        if (limite.minItems !== undefined && nodo.length < limite.minItems) {
          errori.push(`${dove}: troppo pochi elementi`);
        }
        if (limite.maxItems !== undefined && nodo.length > limite.maxItems) {
          if (correggi) {
            nodo.splice(limite.maxItems);
            correzioni.push(dove);
          } else {
            errori.push(`${dove}: troppi elementi`);
          }
        }
      }
    }
    if (Array.isArray(nodo)) {
      for (const [indice, elemento] of nodo.entries()) {
        visita(elemento, [...segmenti, String(indice)], (nuovo) => {
          nodo[indice] = nuovo;
        });
      }
    } else if (isRecord(nodo)) {
      for (const [chiave, figlio] of Object.entries(nodo)) {
        visita(figlio, [...segmenti, chiave], (nuovo) => {
          nodo[chiave] = nuovo;
        });
      }
    }
  };
  visita(copia, [], () => undefined);
  return { valore: copia, correzioni, errori };
}

// ─── Normalizzazione sul catalogo ────────────────────────────────────────────────────────────────────────────────

/** Un parametro dell'uscita del classificatore (forma minima). @public */
export type ParametroUscita = {
  chiave: string;
  valore: number | string | boolean;
  min?: number;
  max?: number;
  confidenza: number;
  fonte: string;
  motivo: string;
};

/** L'uscita del classificatore nella forma minima che la normalizzazione tocca. @public */
export type UscitaMinima = {
  [chiave: string]: unknown;
  famiglia: { id: string; confidenza: number; alternative: Array<{ id: string; confidenza: number }> };
  variante: { id: string; confidenza: number };
  parametri: ParametroUscita[];
  domande: Array<{ chiave: string; motivo: string; proposte: number[] }>;
};

/** Confidenza di un valore riportato nei limiti o sostituito dal predefinito (specifica §2.4). @public */
export const confidenzaCorretto = 0.3;
/** Tetto della confidenza di un parametro non visibile (regola 3 del prompt). @public */
export const confidenzaNonVisibile = 0.4;

const numerico = (unita: string): boolean => ['mm', 'deg', 'n', 'frazione'].includes(unita);

/**
 * Normalizza l'uscita sul catalogo della sua famiglia (specifica §2.4, post-elaborazione): parametri sconosciuti o
 * derivati scartati, valori fuori dai limiti riportati dentro con `fonte: default_mestiere` e confidenza 0,3, tipi e
 * voci d'elenco sbagliati sostituiti dal predefinito, variante sconosciuta → la prima, domande su chiavi ignote o senza
 * tre proposte tolte. Per `libero`/`non_modellabile` parametri e domande si svuotano.
 * @param uscita - L'uscita già conforme alla struttura (non modificata).
 * @param famiglie - Il catalogo.
 * @returns L'uscita normalizzata, le chiavi scartate e quelle corrette.
 * @public
 */
export function normalizzaUscita<T extends UscitaMinima>(
  uscita: T,
  famiglie: readonly FamigliaCatalogo[],
): { uscita: T; scartati: string[]; corretti: string[] } {
  const copia = structuredClone(uscita);
  const scartati: string[] = [];
  const corretti: string[] = [];
  const famiglia = famiglie.find((voce) => voce.id === copia.famiglia.id);
  if (famiglia === undefined) {
    scartati.push(...copia.parametri.map((parametro) => parametro.chiave));
    copia.parametri = [];
    copia.domande = [];
    return { uscita: copia, scartati, corretti };
  }
  if (!famiglia.varianti.includes(copia.variante.id)) {
    copia.variante = { id: famiglia.varianti[0] ?? copia.variante.id, confidenza: confidenzaCorretto };
    corretti.push('variante');
  }
  const definizioni = new Map(
    famiglia.parametri
      .filter((parametro) => !parametro.derivato && parametro.unita !== 'contorno')
      .map((parametro) => [parametro.chiave, parametro]),
  );
  const visti = new Set<string>();
  const parametri: ParametroUscita[] = [];
  for (const parametro of copia.parametri) {
    const definizione = definizioni.get(parametro.chiave);
    if (definizione === undefined || visti.has(parametro.chiave)) {
      scartati.push(parametro.chiave);
      continue;
    }
    visti.add(parametro.chiave);
    const corretto = { ...parametro };
    const sostituisci = (valore: number | string | boolean): void => {
      corretto.valore = valore;
      corretto.fonte = 'default_mestiere';
      corretto.confidenza = Math.min(corretto.confidenza, confidenzaCorretto);
      corretti.push(parametro.chiave);
    };
    const base = definizione.default as number | string | boolean;
    if (numerico(definizione.unita)) {
      if (typeof corretto.valore === 'number') {
        let valore = definizione.unita === 'n' ? Math.round(corretto.valore) : corretto.valore;
        valore = definizione.min === undefined ? valore : Math.max(definizione.min, valore);
        valore = definizione.max === undefined ? valore : Math.min(definizione.max, valore);
        if (valore !== corretto.valore) {
          sostituisci(valore);
        }
      } else {
        sostituisci(base);
      }
      const limita = (valore: number | undefined): number | undefined =>
        valore === undefined
          ? undefined
          : Math.min(definizione.max ?? Infinity, Math.max(definizione.min ?? -Infinity, valore));
      const minimo = limita(corretto.min);
      const massimo = limita(corretto.max);
      if (minimo !== undefined && massimo !== undefined && minimo > massimo) {
        corretto.min = massimo;
        corretto.max = minimo;
      } else {
        if (minimo === undefined) {
          delete corretto.min;
        } else {
          corretto.min = minimo;
        }
        if (massimo === undefined) {
          delete corretto.max;
        } else {
          corretto.max = massimo;
        }
      }
    } else {
      delete corretto.min;
      delete corretto.max;
      if (definizione.unita === 'enum') {
        if (typeof corretto.valore !== 'string' || !(definizione.valori ?? []).includes(corretto.valore)) {
          sostituisci(base);
        }
      } else if (definizione.unita === 'bool') {
        if (typeof corretto.valore !== 'boolean') {
          sostituisci(base);
        }
      } else if (typeof corretto.valore !== 'string') {
        sostituisci(base);
      }
    }
    if (corretto.fonte === 'non_visibile') {
      corretto.confidenza = Math.min(corretto.confidenza, confidenzaNonVisibile);
    }
    parametri.push(corretto);
  }
  copia.parametri = parametri;
  copia.domande = copia.domande
    .filter((domanda) => {
      const valida = definizioni.has(domanda.chiave) && domanda.proposte.length === 3;
      if (!valida) {
        scartati.push(`domanda:${domanda.chiave}`);
      }
      return valida;
    })
    .map((domanda) => ({ ...domanda, proposte: [...domanda.proposte].sort((a, b) => a - b) }));
  return { uscita: copia, scartati, corretti };
}
