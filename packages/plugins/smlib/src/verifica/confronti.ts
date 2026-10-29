import type { IdFamiglia } from '#famiglie/famiglia.js';
import { famiglie } from '#famiglie/registro.js';
import type { CameraFaccia } from '#famiglie/viste.js';
import { richiestaDaScheda } from '#verifica/pipeline.js';
import type { SchedaPerVerifica } from '#verifica/pipeline.js';
import type { RichiestaVerifica, RispostaVerifica } from '#verifica/verifica-funzioni.js';
import { cameraDaVista } from '#verifica/vista-famiglia.js';

/**
 * La verifica sulle tre immagini (piano «viste ortogonali», §2.5), pura: le regole, non i calcoli. I calcoli li fa il
 * worker della verifica (`verificaSilhouette`) con le richieste costruite qui.
 *
 * 1. L'ottimizzatore lavora sulla **vista principale** generata: piatta e completa, guardata dalla sua faccia (azimuth ed
 *    elevation fissi, `cameraFaseA: 'piano'`), scala libera. I millimetri vengono da un'**ancora**: il parametro critico
 *    con la fonte migliore resta fermo, così la vista dà i rapporti e l'ancora la misura.
 * 2. Poi due **confronti a parametri fermi** (solo la camera si muove): la vista di controllo, dalla sua faccia; la foto
 *    originale, dalla vista che il riconoscimento ha stimato e con la scala della foto.
 * 3. L'**esito**: controllo sotto soglia = viste incoerenti fra loro; foto sotto soglia con la parte intera = la vista
 *    ricostruita non corrisponde alla foto; con la parte solo in parte visibile la foto non decide, e le misure critiche
 *    non dichiarate tornano domande.
 */

/**
 * Le soglie dell'IoU dei confronti, tarate sul set sintetico (la tabella è in `confronti.test.ts`): con viste coerenti
 * la foto sta fra 0,855 e 0,964 e un tacco del 40 % più alto nella foto fra 0,53 e 0,79, quindi 0,85; il controllo
 * coerente sta sopra 0,9 tranne lo stiletto (0,62: un pezzo sottile visto da dietro), quello di un altro pezzo fra 0,44
 * e 0,79, quindi 0,80, ma decide da solo solo quando la foto non può decidere (vedi {@link esitoConfronti}). Il
 * generatore non fa vera ortografia: soglie più strette darebbero falsi «non combacia».
 * @public
 */
export const soglieConfronti = { controllo: 0.8, sorgente: 0.85 } as const;

/** Le fonti che possono fare da ancora, dalla migliore. `taglia` e `proporzione` solo con confidenza ≥ 0,7. @public */
export const fontiAncora = ['misura_nota', 'libreria', 'catalogo', 'taglia', 'proporzione'] as const;

const fontiDichiarate: ReadonlySet<string> = new Set(['misura_nota', 'libreria', 'catalogo']);

/** Confidenza minima di un'ancora che non è una misura dichiarata. @public */
export const confidenzaAncora = 0.7;

/** Confidenza di una misura da confermare: sotto la soglia delle domande (0,6), come le ipotesi della verifica. */
const confidenzaIpotesi = 0.5;

/** Il parametro che dà i millimetri alla vista generata. @public */
export type Ancora = Readonly<{ chiave: string; fonte: string; confidenza: number }>;

const definizioniCritiche = (famiglia: string) => {
  const voce = Object.hasOwn(famiglie, famiglia) ? famiglie[famiglia as IdFamiglia] : undefined;
  return new Map(
    (voce?.parametri ?? [])
      .filter((definizione) => definizione.critico === true && definizione.unita === 'mm')
      .map((definizione) => [definizione.chiave, definizione]),
  );
};

/**
 * L'ancora di scala: fra i parametri critici in millimetri, quello con la fonte migliore (`misura_nota`, `libreria`,
 * `catalogo`, poi `taglia` o `proporzione` con confidenza ≥ 0,7), a parità di fonte il più sicuro.
 * @param scheda - La scheda del riconoscimento.
 * @returns L'ancora, o undefined: allora le misure assolute restano ipotesi.
 * @public
 */
export function ancoraDiScala(scheda: Pick<SchedaPerVerifica, 'famiglia' | 'parametri'>): Ancora | undefined {
  const critiche = definizioniCritiche(scheda.famiglia.id);
  const candidate = scheda.parametri
    .filter(
      (parametro) =>
        critiche.has(parametro.chiave) &&
        typeof parametro.valore === 'number' &&
        (fontiAncora as readonly string[]).includes(parametro.fonte) &&
        (fontiDichiarate.has(parametro.fonte) || parametro.confidenza >= confidenzaAncora),
    )
    .toSorted(
      (a, b) =>
        (fontiAncora as readonly string[]).indexOf(a.fonte) - (fontiAncora as readonly string[]).indexOf(b.fonte) ||
        b.confidenza - a.confidenza,
    );
  const scelta = candidate[0];
  return scelta ? { chiave: scelta.chiave, fonte: scelta.fonte, confidenza: scelta.confidenza } : undefined;
}

/**
 * La camera che guarda dritta una faccia della famiglia.
 * @param famiglia - La famiglia costruita.
 * @param faccia - L'id della faccia.
 * @returns La camera, o undefined se la famiglia non ha quella faccia.
 * @public
 */
export function cameraDellaFaccia(famiglia: string, faccia: string): CameraFaccia | undefined {
  const voce = Object.hasOwn(famiglie, famiglia) ? famiglie[famiglia as IdFamiglia] : undefined;
  return voce?.viste.facce.find((candidata) => candidata.id === faccia)?.camera;
}

/**
 * La richiesta della verifica sulla vista principale generata: la camera dalla sua faccia (fissa negli angoli, libera
 * nel piano), la scala libera, l'ancora ferma insieme alle misure dichiarate e ai valori fissati dall'utente.
 * @param scheda - La scheda del riconoscimento.
 * @param png - La maschera della vista principale (PNG).
 * @param faccia - La faccia che la vista guarda.
 * @param opzioni - Opzioni dell'ottimizzatore (budget…).
 * @param bloccati - Chiavi fissate dall'utente.
 * @returns La richiesta, o undefined se la famiglia non si verifica o non ha quella faccia (famiglia scelta al chip).
 * @public
 */
// oxlint-disable-next-line eslint/max-params -- stessa firma di `richiestaDaScheda`, più la faccia.
export function richiestaDaVistaGenerata(
  scheda: SchedaPerVerifica,
  png: Uint8Array<ArrayBuffer>,
  faccia: string,
  opzioni: RichiestaVerifica['opzioni'] = {},
  bloccati: readonly string[] = [],
): RichiestaVerifica | undefined {
  const camera = cameraDellaFaccia(scheda.famiglia.id, faccia);
  const ancora = ancoraDiScala(scheda);
  const base = camera
    ? richiestaDaScheda(scheda, png, opzioni, ancora ? [...bloccati, ancora.chiave] : bloccati)
    : null;
  if (camera === undefined || base === null) {
    return undefined;
  }
  return {
    ...base,
    // La vista generata è completa e piatta: nessun lato coperto, la faccia è nota.
    vista: {
      azimuth: camera.azimuth,
      elevation: camera.elevation,
      rollo: camera.rollo,
      confidenza: 1,
      latiOcclusi: [],
    },
    scala: { pxPerMmFoto: null, fonte: 'stima' },
    opzioni: { ...base.opzioni, cameraFaseA: 'piano', avvii: 1 },
  };
}

/**
 * Che cosa si confronta: la vista di controllo (dalla sua faccia; `liberi` = i parametri che la principale non vede,
 * che il controllo misura) o la foto originale (a parametri fermi).
 * @public
 */
export type ConfrontoVista = (
  | Readonly<{ tipo: 'controllo'; faccia: string; liberi?: readonly string[] }>
  | Readonly<{ tipo: 'sorgente'; scheda: Pick<SchedaPerVerifica, 'vista' | 'scala'> }>
) &
  Readonly<{
    /** Millisecondi: il tempo massimo del confronto (predefinito quello dell'ottimizzatore). */
    tempoMassimo?: number;
  }>;

/**
 * I parametri che il controllo misura: quelli ottimizzati sulla principale che la sua vista non fissa (sensibilità sotto
 * soglia, o non misurata). Sono gli spessori e le profondità: la larghezza di un tacco vista di fianco.
 * @param principale - La risposta della verifica sulla vista principale.
 * @returns Le chiavi da lasciare libere sul controllo.
 * @public
 */
export function chiaviDelControllo(principale: Pick<RispostaVerifica, 'chiaviOttimizzate' | 'sensibilita'>): string[] {
  const osservate = new Set(principale.sensibilita.filter((voce) => voce.osservabile).map((voce) => voce.chiave));
  return principale.chiaviOttimizzate.filter((chiave) => !osservate.has(chiave));
}

/**
 * La richiesta di un confronto: la geometria è quella uscita dalla vista principale e si muove solo la camera (fase A;
 * nessuna fase C, nessuna misura di sensibilità). Sul controllo si muovono anche i parametri che la principale non vede
 * (`liberi`, un giro di fase B): con loro fermi una vista coerente di un pezzo sottile (lo stiletto da dietro) cadeva a
 * IoU 0,53 sul set sintetico, solo perché le larghezze restavano quelle stimate dal riconoscimento.
 * @param pezzo - Famiglia, variante e parametri della verifica sulla principale.
 * @param png - La maschera da confrontare (PNG).
 * @param confronto - Controllo (faccia) o foto (vista e scala del riconoscimento), con il tempo massimo.
 * @returns La richiesta, o undefined se la famiglia costruita non ha la faccia del controllo.
 * @public
 */
export function richiestaDiConfronto(
  pezzo: Pick<RispostaVerifica, 'famiglia' | 'variante' | 'parametri'>,
  png: Uint8Array<ArrayBuffer>,
  confronto: ConfrontoVista,
): RichiestaVerifica | undefined {
  const voce = famiglie[pezzo.famiglia];
  if (voce === undefined) {
    return undefined;
  }
  const fermi: NonNullable<RichiestaVerifica['opzioni']> = {
    giriParametri: 0,
    valutazioni: { parametri: 0, congiunta: 0 },
    chiavi: [],
    sensibilita: false,
    // oxlint-disable-next-line tau-lint/no-time-unit-suffix -- il nome dell'opzione esistente dell'ottimizzatore.
    ...(confronto.tempoMassimo === undefined ? {} : { budgetMs: confronto.tempoMassimo }),
  };
  const comune = {
    famiglia: pezzo.famiglia,
    ...(pezzo.variante === undefined ? {} : { variante: pezzo.variante }),
    stima: { parametri: pezzo.parametri, confidenze: {} },
    maschera: { png },
  };
  if (confronto.tipo === 'controllo') {
    const camera = cameraDellaFaccia(pezzo.famiglia, confronto.faccia);
    if (camera === undefined) {
      return undefined;
    }
    const liberi = confronto.liberi ?? [];
    return {
      ...comune,
      vista: { ...camera, confidenza: 1, latiOcclusi: [] },
      scala: { pxPerMmFoto: null, fonte: 'stima' },
      opzioni: {
        ...fermi,
        ...(liberi.length > 0 ? { chiavi: liberi, giriParametri: 1, valutazioni: { congiunta: 0 } } : {}),
        cameraFaseA: 'piano',
        avvii: 1,
      },
    };
  }
  const { vista, scala } = confronto.scheda;
  const camera = cameraDaVista(voce.viste, vista);
  return {
    ...comune,
    vista: {
      azimuth: camera.azimuth,
      elevation: camera.elevation,
      rollo: camera.rollo,
      confidenza: vista.confidenza,
      latiOcclusi: vista.latiOcclusi,
    },
    scala: { pxPerMmFoto: scala.pxPerMm, fonte: scala.fonte },
    opzioni: fermi,
  };
}

/** Il verdetto dei confronti. @public */
export type EsitoConfronti = Readonly<{
  /** `ipotesi`: la parte si vede solo in parte, la foto non decide; le misure critiche diventano domande. */
  esito: 'combacia' | 'non_combacia' | 'ipotesi';
  /** Perché non combacia: le viste fra loro, o la ricostruzione con la foto. */
  motivo?: 'viste_incoerenti' | 'sorgente';
}>;

/**
 * Il verdetto dei confronti (§2.5.4). La foto decide (piano §4: se contraddice una vista generata vince la foto):
 * - parte intera e foto confrontata: sotto 0,85 la ricostruzione non corrisponde alla foto, sopra combacia (un
 *   controllo incoerente vuol dire solo che le sue misure non si usano);
 * - foto che non decide (parte tagliata, piccola o coperta, o foto non confrontabile): un controllo sotto 0,80 vuol dire
 *   viste incoerenti fra loro; altrimenti, con la parte solo in parte visibile, le misure critiche restano ipotesi.
 *
 * Scostamento motivato dal piano, che faceva decidere il controllo sempre: sul set sintetico lo stiletto coerente
 * scendeva a 0,62 sul controllo e sarebbe stato un falso «non combacia» a ogni stiletto.
 * @param iou - Gli IoU dei confronti fatti (un confronto mancante non decide).
 * @param visibilita - Se la parte si vede intera nella foto.
 * @param soglie - Le soglie (predefinite quelle tarate).
 * @returns Il verdetto.
 * @public
 */
export function esitoConfronti(
  iou: Readonly<{ controllo?: number; sorgente?: number }>,
  visibilita: 'intera' | 'parziale',
  soglie: Readonly<{ controllo: number; sorgente: number }> = soglieConfronti,
): EsitoConfronti {
  if (visibilita === 'intera' && iou.sorgente !== undefined) {
    return iou.sorgente < soglie.sorgente ? { esito: 'non_combacia', motivo: 'sorgente' } : { esito: 'combacia' };
  }
  if (iou.controllo !== undefined && iou.controllo < soglie.controllo) {
    return { esito: 'non_combacia', motivo: 'viste_incoerenti' };
  }
  return visibilita === 'parziale' ? { esito: 'ipotesi' } : { esito: 'combacia' };
}

/** Le verifiche fatte sulle tre immagini, come arrivano dal worker. @public */
export type VerificheConfronti = Readonly<{
  /** La verifica sulla vista principale (parametri ottimizzati). */
  principale: RispostaVerifica;
  /** Il controllo, con i parametri che la principale non vede lasciati liberi. */
  controllo?: RispostaVerifica;
  /** I parametri lasciati liberi sul controllo. */
  liberi?: readonly string[];
  /** La foto confrontata con i parametri della sola principale. */
  sorgentePrincipale?: RispostaVerifica;
  /** La foto confrontata con i parametri della principale più le misure del controllo. */
  sorgenteControllo?: RispostaVerifica;
}>;

/** Il risultato dei confronti: il verdetto, gli IoU e la verifica da consegnare. @public */
export type RisultatoConfronti = EsitoConfronti &
  Readonly<{
    iou: Readonly<{ principale: number; controllo?: number; sorgente?: number }>;
    /** Da quale insieme di parametri nasce il pezzo. */
    parametri: 'principale' | 'controllo';
    /** La verifica da consegnare: quella della principale, con le misure del controllo se si usano. */
    risposta: RispostaVerifica;
    /** Il confronto con la foto scelto (la sua camera è quella della foto). */
    sorgente?: RispostaVerifica;
  }>;

/**
 * Il risultato dei confronti: le misure del controllo si usano se il controllo combacia e la foto non le smentisce
 * (IoU sulla foto non più basso di 0,01); allora i parametri che il controllo ha misurato contano come osservati. Poi
 * il verdetto di {@link esitoConfronti} sugli IoU dell'insieme scelto.
 * @param verifiche - Le verifiche fatte.
 * @param visibilita - Se la parte si vede intera nella foto.
 * @returns Il risultato.
 * @public
 */
export function risultatoConfronti(
  verifiche: VerificheConfronti,
  visibilita: 'intera' | 'parziale',
): RisultatoConfronti {
  const { principale, controllo, sorgentePrincipale, sorgenteControllo } = verifiche;
  const liberi = verifiche.liberi ?? [];
  const controlloBuono = controllo !== undefined && controllo.iou >= soglieConfronti.controllo && liberi.length > 0;
  const fotoNonSmentisce =
    sorgenteControllo === undefined
      ? sorgentePrincipale === undefined
      : sorgentePrincipale === undefined || sorgenteControllo.iou >= sorgentePrincipale.iou - 0.01;
  const usaControllo = controlloBuono && fotoNonSmentisce;
  const sorgente = usaControllo ? (sorgenteControllo ?? sorgentePrincipale) : sorgentePrincipale;
  const misurati = new Set(liberi);
  const risposta: RispostaVerifica = usaControllo
    ? {
        ...principale,
        parametri: controllo.parametri,
        // Ciò che il controllo ha misurato non è più un'ipotesi della principale.
        sensibilita: [
          ...principale.sensibilita.filter((voce) => !misurati.has(voce.chiave)),
          ...liberi.map((chiave) => ({
            chiave,
            sensibilita: 1,
            degrado: 1,
            osservabile: true,
            banda: [0, 0] as const,
          })),
        ],
      }
    : principale;
  const iou = {
    principale: principale.iou,
    ...(controllo === undefined ? {} : { controllo: controllo.iou }),
    ...(sorgente === undefined ? {} : { sorgente: sorgente.iou }),
  };
  return {
    ...esitoConfronti(iou, visibilita),
    iou,
    parametri: usaControllo ? 'controllo' : 'principale',
    risposta,
    ...(sorgente === undefined ? {} : { sorgente }),
  };
}

/**
 * Le misure da confermare: i parametri critici in millimetri che non vengono da una misura dichiarata, i meno sicuri
 * prima, al più due.
 * @param scheda - Famiglia e parametri.
 * @param massimo - Quante al più (predefinito 2).
 * @returns Le chiavi.
 * @public
 */
export function misureDaConfermare(scheda: Pick<SchedaPerVerifica, 'famiglia' | 'parametri'>, massimo = 2): string[] {
  const critiche = definizioniCritiche(scheda.famiglia.id);
  return scheda.parametri
    .filter(
      (parametro) =>
        critiche.has(parametro.chiave) && typeof parametro.valore === 'number' && !fontiDichiarate.has(parametro.fonte),
    )
    .toSorted((a, b) => a.confidenza - b.confidenza)
    .slice(0, massimo)
    .map((parametro) => parametro.chiave);
}

/**
 * Segna come ipotesi le misure date (confidenza al più 0,5): sotto la soglia delle domande, tornano chip
 * nell'ispettore con il meccanismo che c'è già (`domandeParametri`).
 * @param scheda - Una scheda con i parametri.
 * @param chiavi - Le misure da confermare.
 * @param motivo - Il motivo da scrivere (≤ 140 caratteri), se si vuole cambiare quello del riconoscimento.
 * @returns Una copia con le misure abbassate.
 * @public
 */
export function confermaMisure<
  T extends { parametri: ReadonlyArray<{ chiave: string; confidenza: number; motivo?: string }> },
>(scheda: T, chiavi: readonly string[], motivo?: string): T {
  const daConfermare = new Set(chiavi);
  return {
    ...scheda,
    parametri: scheda.parametri.map((parametro) =>
      daConfermare.has(parametro.chiave)
        ? {
            ...parametro,
            confidenza: Math.min(parametro.confidenza, confidenzaIpotesi),
            ...(motivo === undefined ? {} : { motivo: motivo.slice(0, 140) }),
          }
        : parametro,
    ),
  };
}
