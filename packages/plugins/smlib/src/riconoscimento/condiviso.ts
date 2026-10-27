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

/** Una famiglia parametrica nel catalogo del contratto. @public */
export type FamigliaCatalogo = {
  id: string;
  versione: number;
  varianti: readonly string[];
  partTypes: readonly string[];
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
};

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
 * @param opzioni - Lingua dei motivi, fattore del ritaglio, rientro.
 * @returns Il contesto.
 * @public
 */
export function contestoDaSchedaParte(
  scheda: SchedaParteMinima,
  vincolo: VincoloFamiglia,
  opzioni: { lingua: 'it' | 'en'; fattoreRitaglio?: number; rientro?: boolean },
): ContestoPrompt {
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
Millimetres and degrees. Every family has a local frame with Z up. The camera angles of \`vista\` are in that frame:
- azimuth 0: the camera stands on −Y and looks along +Y at the −Y face (the render "front"); azimuth 90: from +X; azimuth 180: from +Y; azimuth −90: from −X.
- elevation 90: from straight above (+Z); −90: from straight below.
- rollo: rotation of the picture plane, degrees, positive counter-clockwise (−45…45).

              +Y   (dietro, azimuth 180)
               ^
               |
   (−90) −X <--+--> +X  (fianco, azimuth 90)
               |
              −Y   (fronte, azimuth 0)  <- camera at azimuth 0 stands here, looking toward +Y

View names: fronte (az 0, el 0) · dietro (az 180) · fianco_esterno / fianco_interno (az ±90: esterno is the outer side of the foot, interno the arch side; for parts not tied to a foot use fianco_esterno for +X) · tre_quarti (az ≈ ±45 or ±135) · sopra (el ≈ 90) · sotto (el ≈ −90). \`ortografica\` is true when the photo looks taken from far away or with a long lens (parallel edges stay parallel). \`latiOcclusi\` lists the sides of the picture where the part is hidden by something else (for example the seat of a heel under the shoe).

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
5. \`vista.azimuth\` and \`vista.elevation\` are in the family's local frame (drawing above).
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

/**
 * Il testo dell'utente: la parte, il tipo e il vincolo, la scala nota e come leggere le immagini.
 * @param contesto - Il contesto della richiesta.
 * @returns Il testo (dopo le immagini nel messaggio).
 * @public
 */
export function testoUtente(contesto: ContestoPrompt): string {
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
    contesto.rientro
      ? 'Picture 3: the silhouette of the model built from your previous answer (red) over the mask (blue) does not match: is the family, the variant or the view wrong? Answer again from scratch.'
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
 * @param opzioni - Lingua dei motivi, fattore del ritaglio, rientro dopo la verifica.
 * @returns Il prompt e le famiglie descritte.
 * @public
 */
export function promptRiconoscimento(
  scheda: SchedaParteMinima,
  contratto: Pick<ContrattoRiconoscimento, 'famiglie' | 'mappaPartType' | 'mappaLibreria'>,
  opzioni: { lingua: 'it' | 'en'; fattoreRitaglio?: number; rientro?: boolean },
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
