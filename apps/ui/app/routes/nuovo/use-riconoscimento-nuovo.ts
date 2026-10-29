import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  catalogoFamiglie,
  domandaFamiglia,
  mappaLibreria,
  mappaPartType,
  misureDallaFoto,
  risolviFamiglia,
  visteOrtogonali,
  visteOrtogonaliDi,
} from '@taucad/smlib/riconoscimento';
import type { DomandaFamiglia, MisureFoto, SchedaRiconoscimento, VincoloFamiglia } from '@taucad/smlib/riconoscimento';
import { confermaMisure, misureDaConfermare } from '@taucad/smlib/verifica';
import type { RisultatoConfronti } from '@taucad/smlib/verifica';
import { useProjectManager } from '#hooks/use-project-manager.js';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import { sinopiaStarterKernelId } from '#lib/sinopia-engines.js';
import type { VisteVerifica } from '#machines/riconoscimento.machine.js';
import { homeProjectCreationLocation } from '#types/project-creation-location.types.js';
import { projectUrl } from '#utils/project-url.utils.js';
import { caricaProvaFibbia, visteProvaFibbia } from '#routes/nuovo/prova-fibbia.js';
import {
  mascheraDellaVista,
  preparaImmaginiRiconoscimento,
  strumentiBrowser,
  vistaPerRiconoscimento,
} from '#services/riconoscimento-immagini.js';
import type { ImmaginiRiconoscimento } from '#services/riconoscimento-immagini.js';
import { eseguiPipelineRiconoscimento } from '#services/riconoscimento-pipeline.js';
import { progettoRiconosciuto } from '#services/riconoscimento-progetto.js';
import type { VistaDelProgetto } from '#services/riconoscimento-progetto.js';
import type { RecordRiconoscimento } from '#services/riconoscimento-record.js';
import { creaVerificatoreBrowser } from '#services/riconoscimento-verifica.js';
import { caricaSchedaParte, ErroreParte, leggiVistaDelLink } from '#services/sinopia-parts.js';
import { caricaSchedaPezzo } from '#services/sinopia-pezzo.js';
import type { LetturaNuovo, ParteCaricata, VistaRiusata } from '#services/sinopia-parts.js';
import { leggiPrezziCad } from '#services/sinopia-foto.js';
import {
  ErroreRiconoscimento,
  riconosciParte,
  riconosciUnaVolta,
  riconoscimentoRegistrato,
} from '#services/sinopia-recognize.js';
import type { EsitoRiconoscimento, VistaPerRiconoscimento } from '#services/sinopia-recognize.js';
import {
  chiaveVista,
  decisioneVista,
  ErroreVista,
  generaVista,
  scaricaVista,
  statoVisita,
  vistaUnaVolta,
} from '#services/sinopia-viste.js';
import { readSinopiaCadLink } from '#services/sinopia-cad.js';
import { cercaModelloEsistente } from '#services/sinopia-modello-esistente.js';
import type { ModelloEsistente, OrigineSinopia } from '#services/sinopia-modello-esistente.js';

/**
 * The flow of «/cad/nuovo»: read the part from Sinopia, show what building it costs and wait for «Costruisci», generate
 * the flat views of the part (piano «viste ortogonali»), recognise it, ask the family when the recognition is unsure,
 * check the piece (on the main view, then against the control view and the photo), then build it and open it. Each step
 * shows on the page; a failure says how to go on. When the rebuilt piece does not match the photo, the page says so and
 * offers «Rigenera le viste» or «Conferma le misure». Stopping the check (Esc, «Salta la verifica», leaving the page)
 * ends its worker; the piece is then built from the recognition alone, said so in its record.
 *
 * Nothing is paid twice: the views and the recognition are booked with ids stable for the visit and the round of views
 * (`sessionStorage`), a reload replays them, and only «Rigenera le viste» opens a new round.
 */

/**
 * The part as the page shows it: the sheet, object URLs of the picture and the mask, and, for a part of a Sinopia
 * project, where it comes from (the model will belong to that project, with that image and part as its origin).
 */
export type ParteVista = ParteCaricata &
  Readonly<{ immagineUrl: string; mascheraUrl: string; prova: boolean; origine?: OrigineSinopia }>;

/** Che cosa costa costruire il pezzo: il riconoscimento e le viste da generare. */
export type CostoCostruzione = Readonly<{
  totale: number;
  riconoscimento: number;
  /** Quante viste si generano (0, 1 se la principale si riusa dalla card «Parte isolata», 2). */
  viste: number;
  prezzoVista: number;
  /** La vista principale viene dalla card «Parte isolata». */
  riusata: boolean;
}>;

/** Una vista generata (o riusata) come la pagina la mostra. */
export type VistaMostrata = Readonly<{ ruolo: 'principale' | 'controllo'; faccia: string; url: string }>;

/** Where the flow stands. */
export type FaseNuovo =
  | Readonly<{ fase: 'leggo' }>
  /** The cost is known: nothing starts before «Costruisci». */
  | Readonly<{ fase: 'conferma'; parte: ParteVista; costo: CostoCostruzione }>
  /** The flat views are being generated. */
  | Readonly<{
      fase: 'viste';
      parte: ParteVista;
      passo: 'principale' | 'controllo' | 'preparo';
      viste: VistaMostrata[];
    }>
  | Readonly<{ fase: 'riconosco'; parte: ParteVista; viste?: VistaMostrata[] }>
  /** The part already became a model: open it, or build it again from scratch (only on request: it costs again). */
  | Readonly<{ fase: 'esiste'; parte: ParteVista; modello: ModelloEsistente }>
  | Readonly<{
      fase: 'scegli_famiglia';
      parte: ParteVista;
      esito: EsitoRiconoscimento;
      domanda: DomandaFamiglia;
      viste?: VistaMostrata[];
    }>
  | Readonly<{
      fase: 'verifico';
      parte: ParteVista;
      esito: EsitoRiconoscimento;
      famiglia?: string;
      viste?: VistaMostrata[];
    }>
  /** The piece rebuilt from the views does not match the photo: regenerate them, or build and confirm the measures. */
  | Readonly<{
      fase: 'non_combacia';
      parte: ParteVista;
      esito: EsitoRiconoscimento;
      famiglia?: string;
      viste: VistaMostrata[];
      motivo: 'sorgente' | 'viste_incoerenti';
      iou: number;
      /** What «Rigenera le viste» costs: two views and a recognition. */
      costoRigenera: number;
    }>
  | Readonly<{
      fase: 'costruisco';
      parte: ParteVista;
      esito: EsitoRiconoscimento;
      famiglia?: string;
      /** The check's IoU, when it was made. */
      iou?: number;
      viste?: VistaMostrata[];
    }>
  | Readonly<{ fase: 'fermo'; parte: ParteVista; esito?: EsitoRiconoscimento; messaggio: PlainMessageKey }>
  | Readonly<{
      fase: 'errore';
      parte?: ParteVista;
      messaggio: PlainMessageKey;
      riprova: boolean;
      /** The views failed in a way that can be skipped: «Continua senza viste». */
      senzaViste?: boolean;
    }>;

const messaggioParte: Record<ErroreParte['codice'], PlainMessageKey> = {
  progettoAssente: 'riconoscimento.errors.projectMissing',
  immagineAssente: 'riconoscimento.errors.imageMissing',
  partiAssenti: 'riconoscimento.errors.partsMissing',
  parteAssente: 'riconoscimento.errors.partMissing',
  mascheraAssente: 'riconoscimento.errors.maskMissing',
  pezzoAssente: 'riconoscimento.errors.pieceMissing',
  immagineTroppoGrande: 'riconoscimento.errors.imageTooLarge',
};

const messaggioRiconoscimento = (errore: ErroreRiconoscimento): PlainMessageKey =>
  errore.codice === 'RECOGNITION_REFUSED'
    ? 'riconoscimento.errors.refused'
    : errore.codice === 'BILLING_ACCOUNT_RESTRICTED' || errore.codice === 'CAD_PILOT_NOT_ALLOWED'
      ? 'riconoscimento.errors.restricted'
      : errore.codice === 'RATE_LIMITED'
        ? 'riconoscimento.errors.rateLimited'
        : errore.codice === 'INVALID_REQUEST' && errore.message.includes('non si modella')
          ? 'riconoscimento.errors.notModelable'
          : errore.codice === 'CREDITS_NOT_CONFIGURED'
            ? 'riconoscimento.errors.creditsNotConfigured'
            : errore.codice === 'INSUFFICIENT_CREDITS'
              ? 'riconoscimento.errors.insufficientCredits'
              : 'riconoscimento.errors.unavailable';

/**
 * The sheet the check starts from: the recognition's, or, when the designer chose another family at the chip, that
 * family from its defaults (the recognised parameters belonged to the other one).
 */
const schedaPerVerifica = (scheda: SchedaRiconoscimento, famiglia: string | undefined): SchedaRiconoscimento => {
  if (famiglia === undefined || famiglia === scheda.famiglia.id) {
    return scheda;
  }
  const scelta = catalogoFamiglie().find((voce) => voce.id === famiglia);
  return {
    ...scheda,
    famiglia: { id: famiglia as SchedaRiconoscimento['famiglia']['id'], confidenza: 1, alternative: [] },
    variante: { id: scelta?.varianti[0] ?? scheda.variante.id, confidenza: 1 },
    parametri: [],
    domande: [],
  };
};

/** In the trial the recognition takes a moment, so its step can be seen. */
const attesaProva = 900;
/** The trial's prices: what Sinopia charges today (`cad_recognize` 2, `cad_part_view` 2). */
const prezziProva = { riconoscimento: 2, vista: 2 } as const;

const aspetta = async (millisecondi: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, millisecondi);
  });

/** Una vista pronta: i suoi byte, la maschera per la verifica e che cosa dice di lei Sinopia. */
type VistaPronta = Readonly<{
  ruolo: 'principale' | 'controllo';
  faccia: string;
  assetId: string;
  immagine: Blob;
  maschera?: Uint8Array<ArrayBuffer>;
  riusata?: boolean;
}>;

/** Che cosa la pagina sa delle viste prima di partire: la famiglia, quante generarne e la principale da riusare. */
type PianoViste = Readonly<{ famiglia?: string; quante: number; riusata?: VistaRiusata }>;

/** La famiglia che vincolo e parole indicano, quando la tabella delle viste la conosce. */
const famigliaConViste = (vincolo: VincoloFamiglia): string | undefined =>
  vincolo.famiglia !== undefined && visteOrtogonaliDi(vincolo.famiglia, vincolo.variante) !== undefined
    ? vincolo.famiglia
    : undefined;

/**
 * Le viste del pezzo prima di partire: nessuna per la Libreria e i fornitori (sono già foto del pezzo da solo) e per
 * una parte senza famiglia nota; altrimenti principale e controllo, o il solo controllo se la card «Parte isolata»
 * ha già la principale giusta.
 */
const pianoViste = async (lettura: LetturaNuovo, vincolo: VincoloFamiglia): Promise<PianoViste> => {
  if (lettura.stato === 'prova') {
    return { famiglia: 'fibbia', quante: 2 };
  }
  const famiglia = lettura.stato === 'parte' ? famigliaConViste(vincolo) : undefined;
  if (lettura.stato !== 'parte' || famiglia === undefined) {
    return { quante: 0 };
  }
  const voce = visteOrtogonali[famiglia as keyof typeof visteOrtogonali];
  const principali = [voce.principale, ...Object.values(voce.varianti ?? {}).map((variante) => variante.principale)];
  const riusata = await leggiVistaDelLink(lettura.parametri, { famiglia, facce: principali });
  return riusata ? { famiglia, quante: 1, riusata } : { famiglia, quante: 2 };
};

/** Why the views stopped the flow, with the page's words and the way on. */
class FermoViste extends Error {
  public readonly messaggio: PlainMessageKey;
  public readonly riprova: boolean;
  /** «Continua senza viste» is offered. */
  public readonly senzaViste: boolean;
  /** The price changed: the cost is shown again before going on. */
  public readonly riconferma: boolean;

  public constructor(
    messaggio: PlainMessageKey,
    modo: Readonly<{ riprova: boolean; senzaViste?: boolean; riconferma?: boolean }>,
  ) {
    super(messaggio);
    this.name = 'FermoViste';
    this.messaggio = messaggio;
    this.riprova = modo.riprova;
    this.senzaViste = modo.senzaViste ?? false;
    this.riconferma = modo.riconferma ?? false;
  }
}

/**
 * Run the flow for the address read by the route.
 *
 * @param lettura - What the address asks for.
 * @param lingua - The interface language (the reasons the recognition writes).
 * @returns The current step and its actions.
 */
export function useRiconoscimentoNuovo(
  lettura: LetturaNuovo,
  lingua: 'it' | 'en',
): Readonly<{
  fase: FaseNuovo;
  /** «Costruisci · N crediti»: the designer accepts the cost, the flow starts. */
  costruisci: () => void;
  scegliFamiglia: (famiglia: string) => void;
  riprova: () => void;
  /** Go on with the photo alone after the views failed. */
  continuaSenzaViste: () => void;
  /** «Rigenera le viste»: a new round of views and recognition (it costs again). */
  rigeneraViste: () => void;
  /** «Conferma le misure»: build the piece with the key measures as hypotheses, asked in the inspector. */
  confermaLeMisure: () => void;
  /** Stop the check (and its worker) and build the piece from the recognition alone. */
  saltaVerifica: () => void;
  /** Open the model the part already has. */
  apriEsistente: () => void;
  /** Build the part again, as a new model in the same Sinopia project. */
  rifaiDaCapo: () => void;
}> {
  const navigate = useNavigate();
  const projectManager = useProjectManager();
  const { recordFiles } = useFileManager();
  const session = useSinopiaSession();
  const userId = session.status === 'signed-in' ? session.user.id : undefined;
  /** Set by «Rifallo da capo»: this visit no longer asks about the existing model. */
  const rifai = useRef(false);
  /**
   * The visit a recognition is booked under (the address and the number of «Rifallo da capo»): a reload or a «Riprova»
   * repeats its request, so Sinopia charges it once; rebuilding from scratch is a new visit.
   */
  const rifacimenti = useRef(0);
  const visita = useRef('');
  /** «Continua senza viste»: this visit goes on with the photo alone. */
  const senzaViste = useRef(false);
  const [fase, setFase] = useState<FaseNuovo>(
    lettura.stato === 'incompleto'
      ? { fase: 'errore', messaggio: 'riconoscimento.errors.incomplete', riprova: false }
      : { fase: 'leggo' },
  );
  const [giro, setGiro] = useState(0);
  const urls = useRef<string[]>([]);
  /** The part read in this visit: a step that runs the flow again does not read it twice. */
  const parteLetta = useRef<{ visita: string; parte: ParteVista } | undefined>(undefined);
  /** The flow's own controller (the page going away) and the check's (Esc / «Salta la verifica»). */
  const flusso = useRef<AbortController | undefined>(undefined);
  const verifica = useRef<AbortController | undefined>(undefined);
  /** The two pictures the recognition took, for the second round. */
  const immaginiRientro = useRef<ImmaginiRiconoscimento | undefined>(undefined);
  /** What the views and the photo said, for «Conferma le misure» after «non combacia». */
  const inSospeso = useRef<
    | Readonly<{
        parte: ParteVista;
        esito: EsitoRiconoscimento;
        famiglia?: string;
        verifica: RecordRiconoscimento['verifica'];
        viste: readonly VistaPronta[];
        confronti: RisultatoConfronti;
      }>
    | undefined
  >(undefined);
  /** The views of this round and their measures, for the check. */
  const visteGiro = useRef<{ viste: readonly VistaPronta[]; misure?: MisureFoto }>({ viste: [] });
  /** What «Rigenera le viste» costs: kept from the prices read for the confirmation. */
  const costoRigenera = useRef(0);
  /** One object URL per view file, revoked when the page goes away. */
  const urlViste = useRef(new WeakMap<Blob, string>());

  const mostra = useCallback((viste: readonly VistaPronta[]): VistaMostrata[] => {
    return viste.map((vista) => {
      let url = urlViste.current.get(vista.immagine);
      if (url === undefined) {
        url = URL.createObjectURL(vista.immagine);
        urlViste.current.set(vista.immagine, url);
        urls.current.push(url);
      }
      return { ruolo: vista.ruolo, faccia: vista.faccia, url };
    });
  }, []);

  /** Create the CAD project of the piece and open it. */
  const crea = useCallback(
    async (
      ingresso: Readonly<{
        parte: ParteVista;
        esito: EsitoRiconoscimento;
        famiglia?: string;
        verifica: RecordRiconoscimento['verifica'];
        viste: readonly VistaPronta[];
        confronti?: RisultatoConfronti;
        ipotesi?: readonly string[];
      }>,
    ): Promise<void> => {
      const { parte, esito, famiglia } = ingresso;
      const maschera = new Uint8Array(await parte.mascheraPng.arrayBuffer());
      const vistePerProgetto: VistaDelProgetto[] = await Promise.all(
        ingresso.viste.map(async (vista) => ({
          ruolo: vista.ruolo,
          faccia: vista.faccia,
          assetId: vista.assetId,
          bytes: new Uint8Array(await vista.immagine.arrayBuffer()),
          tipo: vista.immagine.type || 'image/png',
          ...(vista.ruolo === 'principale' && ingresso.confronti
            ? { iou: ingresso.confronti.iou.principale }
            : vista.ruolo === 'controllo' && ingresso.confronti?.iou.controllo !== undefined
              ? { iou: ingresso.confronti.iou.controllo }
              : {}),
          ...(vista.riusata ? { riusata: true } : {}),
        })),
      );
      const progetto = progettoRiconosciuto({
        scheda: esito.scheda,
        schedaParte: parte.schedaParte,
        immagine: {
          bytes: new Uint8Array(await parte.immagine.arrayBuffer()),
          tipo: parte.immagine.type || 'image/png',
        },
        maschera,
        lingua,
        verifica: ingresso.verifica,
        ...(famiglia === undefined ? {} : { famigliaScelta: famiglia }),
        ...(vistePerProgetto.length > 0 ? { viste: vistePerProgetto } : {}),
        ...(ingresso.confronti
          ? {
              confronti: {
                esito: ingresso.confronti.esito,
                ...(ingresso.confronti.motivo ? { motivo: ingresso.confronti.motivo } : {}),
                ...(ingresso.confronti.iou.controllo === undefined
                  ? {}
                  : { controllo: ingresso.confronti.iou.controllo }),
                ...(ingresso.confronti.iou.sorgente === undefined ? {} : { sorgente: ingresso.confronti.iou.sorgente }),
                parametri: ingresso.confronti.parametri,
                ...(ingresso.ipotesi && ingresso.ipotesi.length > 0 ? { ipotesi: [...ingresso.ipotesi] } : {}),
              },
            }
          : {}),
      });
      if (progetto === undefined) {
        setFase({ fase: 'fermo', parte, esito, messaggio: 'riconoscimento.errors.freePart' });
        return;
      }
      if (flusso.current?.signal.aborted) {
        return;
      }
      try {
        const { origine } = parte;
        const creato = await projectManager.createProject({
          kernel: sinopiaStarterKernelId,
          projectName: progetto.nome,
          files: progetto.files,
          location: homeProjectCreationLocation,
          // One project: a part of a Sinopia project builds a model OF that project, never a second project.
          ...(origine === undefined
            ? {}
            : {
                sinopiaProjectId: origine.projectId,
                sinopiaSource: { assetId: origine.assetId, partId: origine.partId },
              }),
        });
        await navigate(projectUrl(creato.slugs));
      } catch (error) {
        console.error('Failed to create the recognised piece’s project:', error);
        setFase({ fase: 'errore', parte, messaggio: 'riconoscimento.errors.createFailed', riprova: true });
      }
    },
    [lingua, navigate, projectManager],
  );

  /** Le misure critiche non dichiarate come ipotesi, con il loro motivo: tornano domande nell'ispettore. */
  const conIpotesi = useCallback(
    (esito: EsitoRiconoscimento): { esito: EsitoRiconoscimento; ipotesi: string[] } => {
      const ipotesi = misureDaConfermare(esito.scheda);
      const motivo =
        lingua === 'it'
          ? 'Da confermare: la foto non decide questa misura.'
          : 'To confirm: the photo does not decide this measure.';
      return { esito: { ...esito, scheda: confermaMisure(esito.scheda, ipotesi, motivo) }, ipotesi };
    },
    [lingua],
  );

  const costruisciPezzo = useCallback(
    async (parte: ParteVista, esito: EsitoRiconoscimento, famiglia?: string): Promise<void> => {
      const maschera = new Uint8Array(await parte.mascheraPng.arrayBuffer());
      const segno = (famiglia === undefined ? {} : { famiglia }) as { famiglia?: string };
      const { viste, misure } = visteGiro.current;
      const mostrate = viste.length > 0 ? mostra(viste) : undefined;
      const conViste = mostrate ? { viste: mostrate } : {};
      setFase({ fase: 'verifico', parte, esito, ...segno, ...conViste });
      // The check: the machine of the pipeline with the real clients. A stop, a failure or a part now said free-form
      // never keeps the piece from opening: it is built from the recognition, and the record says why.
      const controlloVerifica = new AbortController();
      verifica.current = controlloVerifica;
      const verificatore = creaVerificatoreBrowser();
      const segnale = flusso.current
        ? AbortSignal.any([flusso.current.signal, controlloVerifica.signal])
        : controlloVerifica.signal;
      const principale = viste.find((vista) => vista.ruolo === 'principale' && vista.maschera);
      const controllo = viste.find((vista) => vista.ruolo === 'controllo' && vista.maschera);
      const visteVerifica: VisteVerifica | undefined = principale
        ? {
            principale: { png: principale.maschera!, faccia: principale.faccia },
            ...(controllo ? { controllo: { png: controllo.maschera!, faccia: controllo.faccia } } : {}),
            visibilita: misure?.visibilita.stato ?? 'intera',
          }
        : undefined;
      const risultato = await eseguiPipelineRiconoscimento({
        scheda: schedaPerVerifica(esito.scheda, famiglia),
        maschera,
        progettoId: parte.schedaParte.progetto.id,
        parteId: parte.schedaParte.parte.id,
        verificatore,
        ...(visteVerifica ? { viste: visteVerifica } : {}),
        rientro: async ({ scheda, differenzaPng, testo, iou }) => {
          if (parte.prova || immaginiRientro.current === undefined) {
            return scheda;
          }
          const immagini = immaginiRientro.current;
          // The second round belongs to the round of views: after «Rigenera» it is a new request.
          const giroViste = statoVisita.leggi(visita.current).giro;
          const seconda = await riconosciUnaVolta(
            `${visita.current}:${String(giroViste)}:rientro`,
            lingua,
            async (richiesta) =>
              riconosciParte(
                {
                  schedaParte: parte.schedaParte,
                  immagini,
                  lingua: richiesta.lingua,
                  rientro: { differenzaPng, testo, iou },
                },
                { segnale, requestId: richiesta.requestId },
              ),
          );
          return seconda.scheda;
        },
        lingua,
        segnale,
      });
      verificatore.chiudi();
      verifica.current = undefined;
      if (flusso.current?.signal.aborted) {
        return;
      }
      if (risultato.tipo === 'libero') {
        setFase({ fase: 'fermo', parte, esito, messaggio: 'riconoscimento.errors.freePart' });
        return;
      }
      const verificata = risultato.tipo === 'consegna';
      const confronti = verificata ? risultato.confronti : undefined;
      const verificaRecord: RecordRiconoscimento['verifica'] = verificata
        ? confronti?.sorgente
          ? // With the views, the record keeps the photo's check: the chips check again on the photo's mask.
            { ...risultato.verifica, iou: confronti.sorgente.iou, camera: { ...confronti.sorgente.camera } }
          : risultato.verifica
        : { stato: 'non_disponibile', motivo: risultato.tipo === 'fermata' ? 'saltata' : 'errore' };
      const esitoFinale = { ...esito, scheda: verificata ? risultato.scheda : esito.scheda };
      if (confronti?.esito === 'non_combacia') {
        inSospeso.current = { parte, esito: esitoFinale, ...segno, verifica: verificaRecord, viste, confronti };
        setFase({
          fase: 'non_combacia',
          parte,
          esito: esitoFinale,
          ...segno,
          viste: mostrate ?? [],
          motivo: confronti.motivo ?? 'sorgente',
          iou: (confronti.motivo === 'viste_incoerenti' ? confronti.iou.controllo : confronti.iou.sorgente) ?? 0,
          costoRigenera: costoRigenera.current,
        });
        return;
      }
      // With the part only partly visible the photo does not decide: the key measures stay hypotheses (questions).
      const { esito: daCostruire, ipotesi } =
        confronti?.esito === 'ipotesi' ? conIpotesi(esitoFinale) : { esito: esitoFinale, ipotesi: [] };
      setFase({
        fase: 'costruisco',
        parte,
        esito: daCostruire,
        ...segno,
        ...(verificaRecord.stato === 'fatta' ? { iou: verificaRecord.iou } : {}),
        ...conViste,
      });
      await crea({
        parte,
        esito: daCostruire,
        ...segno,
        verifica: verificaRecord,
        viste,
        ...(confronti ? { confronti } : {}),
        ipotesi,
      });
    },
    [conIpotesi, crea, lingua, mostra],
  );

  // The flow runs once per address and per «Riprova»: the identity of the callbacks must not restart it.
  const costruisciCorrente = useRef(costruisciPezzo);
  const letturaCorrente = useRef(lettura);
  const utenteCorrente = useRef(userId);
  const projectManagerCorrente = useRef(projectManager);
  const recordFilesCorrenti = useRef(recordFiles);
  const mostraCorrente = useRef(mostra);
  // The language is read when the recognition is booked: changing it on the page does not book another.
  const linguaCorrente = useRef(lingua);
  useEffect(() => {
    linguaCorrente.current = lingua;
    costruisciCorrente.current = costruisciPezzo;
    letturaCorrente.current = lettura;
    utenteCorrente.current = userId;
    projectManagerCorrente.current = projectManager;
    recordFilesCorrenti.current = recordFiles;
    mostraCorrente.current = mostra;
  });
  const chiave = JSON.stringify(lettura);

  useEffect(() => {
    const lettura = letturaCorrente.current;
    if (lettura.stato === 'incompleto') {
      return;
    }
    const controllo = new AbortController();
    flusso.current = controllo;
    visita.current = `${chiave}#${String(rifacimenti.current)}`;
    const visitaFlusso = visita.current;
    const { signal } = controllo;
    /* Read at each step: the page may have gone away while the step awaited. */
    const annullato = (): boolean => signal.aborted;
    // async-iife: bootstrap -- the flow of one visit, abandoned when the page goes away.
    void (async (): Promise<void> => {
      let parte: ParteVista;
      if (parteLetta.current?.visita === visitaFlusso) {
        ({ parte } = parteLetta.current);
      } else {
        setFase({ fase: 'leggo' });
        try {
          const caricata =
            lettura.stato === 'prova'
              ? await caricaProvaFibbia()
              : lettura.stato === 'pezzo'
                ? await caricaSchedaPezzo(lettura.parametri, strumentiBrowser)
                : await caricaSchedaParte(lettura.parametri, strumentiBrowser);
          const immagineUrl = URL.createObjectURL(caricata.immagine);
          const mascheraUrl = URL.createObjectURL(caricata.mascheraPng);
          urls.current.push(immagineUrl, mascheraUrl);
          parte = {
            ...caricata,
            immagineUrl,
            mascheraUrl,
            prova: lettura.stato === 'prova',
            ...(lettura.stato === 'parte'
              ? {
                  origine: {
                    projectId: lettura.parametri.progetto.toLowerCase(),
                    assetId: lettura.parametri.asset.toLowerCase(),
                    partId: lettura.parametri.parte,
                  },
                }
              : {}),
          };
        } catch (error) {
          if (annullato()) {
            return;
          }
          console.error('Failed to read the Sinopia part:', error);
          setFase({
            fase: 'errore',
            messaggio:
              error instanceof ErroreParte ? messaggioParte[error.codice] : 'riconoscimento.errors.unavailable',
            riprova: !(error instanceof ErroreParte),
          });
          return;
        }
        parteLetta.current = { visita: visitaFlusso, parte };
      }
      if (annullato()) {
        return;
      }
      const vincolo = risolviFamiglia(parte.schedaParte.tipo, {
        mappaPartType: mappaPartType as Record<string, never>,
        mappaLibreria: mappaLibreria as Record<string, never>,
      });
      if (vincolo.vincolo === 'vincolata' && vincolo.famiglia === 'non_modellabile') {
        setFase({ fase: 'fermo', parte, messaggio: 'riconoscimento.errors.notModelable' });
        return;
      }
      // Before anything that costs: a part that already became a model is reopened, not rebuilt.
      const utente = utenteCorrente.current;
      if (parte.origine !== undefined && utente !== undefined && !rifai.current) {
        const modello = await cercaModelloEsistente({
          origine: parte.origine,
          userId: utente,
          progettiLocali: async () => projectManagerCorrente.current.getProjects({ includeDeleted: false }),
          leggiLink: async (localId) => readSinopiaCadLink(recordFilesCorrenti.current, `/projects/${localId}`),
        });
        if (annullato()) {
          return;
        }
        if (modello !== undefined) {
          setFase({ fase: 'esiste', parte, modello });
          return;
        }
      }
      // The cost, before any spending: the recognition and the views to generate, from Sinopia's prices.
      let piano: PianoViste;
      let prezzi: Readonly<{ riconoscimento?: number; vista?: number }>;
      try {
        piano = senzaViste.current ? { quante: 0 } : await pianoViste(lettura, vincolo);
        if (parte.prova) {
          prezzi = prezziProva;
        } else {
          const letti = await leggiPrezziCad();
          prezzi = {
            ...(letti.cad_recognize === undefined ? {} : { riconoscimento: letti.cad_recognize }),
            ...(letti.cad_part_view === undefined ? {} : { vista: letti.cad_part_view }),
          };
        }
      } catch (error) {
        if (annullato()) {
          return;
        }
        console.error('Failed to read the prices of the recognition:', error);
        setFase({ fase: 'errore', parte, messaggio: 'riconoscimento.errors.unavailable', riprova: true });
        return;
      }
      if (annullato()) {
        return;
      }
      if (prezzi.riconoscimento === undefined) {
        setFase({ fase: 'errore', parte, messaggio: 'riconoscimento.errors.creditsNotConfigured', riprova: false });
        return;
      }
      const prezzoVista = prezzi.vista ?? 0;
      const quante = prezzi.vista === undefined ? 0 : piano.quante;
      costoRigenera.current = prezzi.riconoscimento + 2 * prezzoVista;
      const stato = statoVisita.leggi(visitaFlusso);
      if (!stato.confermata) {
        setFase({
          fase: 'conferma',
          parte,
          costo: {
            totale: prezzi.riconoscimento + quante * prezzoVista,
            riconoscimento: prezzi.riconoscimento,
            viste: quante,
            prezzoVista,
            riusata: piano.riusata !== undefined && quante > 0,
          },
        });
        return;
      }
      const giroViste = stato.giro;
      // The views: the main one (reused from the «Parte isolata» card, or generated), then the control.
      let viste: VistaPronta[] = [];
      if (quante > 0 && piano.famiglia !== undefined) {
        try {
          viste = await ottieniViste({
            parte,
            famiglia: piano.famiglia,
            // A new round never reuses the Studio's view: it may be the one that did not match.
            ...(piano.riusata && giroViste === 0 ? { riusata: piano.riusata } : {}),
            prova: lettura.stato === 'prova' ? { diversa: lettura.vistaDiversa === true } : undefined,
            visita: visitaFlusso,
            giro: giroViste,
            userId: utente,
            segnale: signal,
            passo: (passo, pronte) => {
              setFase({ fase: 'viste', parte, passo, viste: mostraCorrente.current(pronte) });
            },
          });
        } catch (error) {
          if (annullato()) {
            return;
          }
          if (error instanceof FermoViste) {
            if (error.riconferma) {
              statoVisita.scrivi(visitaFlusso, { ...stato, confermata: false });
              setGiro((numero) => numero + 1);
              return;
            }
            setFase({
              fase: 'errore',
              parte,
              messaggio: error.messaggio,
              riprova: error.riprova,
              ...(error.senzaViste ? { senzaViste: true } : {}),
            });
            return;
          }
          console.error('The views failed:', error);
          viste = [];
        }
      }
      if (annullato()) {
        return;
      }
      const misure =
        lettura.stato === 'pezzo'
          ? undefined
          : misureDallaFoto({
              verticale: parte.schedaParte.progetto.verticale,
              immagine: parte.schedaParte.immagine,
              riquadro: parte.schedaParte.parte.box,
              altreParti: parte.schedaParte.altreParti,
              maschera: parte.maschera,
            });
      visteGiro.current = { viste, ...(misure ? { misure } : {}) };
      const mostrate = viste.length > 0 ? mostraCorrente.current(viste) : undefined;
      setFase({ fase: 'riconosco', parte, ...(mostrate ? { viste: mostrate } : {}) });
      let esito: EsitoRiconoscimento;
      try {
        if (parte.prova) {
          await aspetta(attesaProva);
          esito = riconoscimentoRegistrato({ famigliaIncerta: lettura.stato === 'prova' && lettura.famigliaIncerta });
        } else {
          const immagini = await preparaImmaginiRiconoscimento(
            parte.immagine,
            parte.maschera,
            parte.schedaParte.parte.box,
          );
          immaginiRientro.current = immagini;
          const vistePerRiconoscimento: VistaPerRiconoscimento[] = await Promise.all(
            viste.map(async (vista) =>
              vistaPerRiconoscimento(vista.immagine, vista.ruolo, vista.faccia as VistaPerRiconoscimento['faccia']),
            ),
          );
          esito = await riconosciUnaVolta(
            `${visitaFlusso}:${String(giroViste)}`,
            linguaCorrente.current,
            async (richiesta) =>
              riconosciParte(
                {
                  schedaParte: parte.schedaParte,
                  immagini,
                  lingua: richiesta.lingua,
                  ...(vistePerRiconoscimento.length > 0 ? { viste: vistePerRiconoscimento } : {}),
                  ...(misure ? { misure } : {}),
                },
                { segnale: signal, requestId: richiesta.requestId },
              ),
          );
        }
      } catch (error) {
        if (annullato()) {
          return;
        }
        // The address and the «Riprova» count are what restart this flow, so a failure names them.
        console.error('Recognition failed:', error, { chiave, giro });
        setFase({
          fase: 'errore',
          parte,
          messaggio:
            error instanceof ErroreRiconoscimento
              ? messaggioRiconoscimento(error)
              : 'riconoscimento.errors.unavailable',
          riprova: !(
            error instanceof ErroreRiconoscimento &&
            (error.codice === 'BILLING_ACCOUNT_RESTRICTED' || error.codice === 'CAD_PILOT_NOT_ALLOWED')
          ),
        });
        return;
      }
      if (annullato()) {
        return;
      }
      if (esito.scheda.famiglia.id === 'non_modellabile') {
        setFase({ fase: 'fermo', parte, esito, messaggio: 'riconoscimento.errors.notModelable' });
        return;
      }
      const domanda = domandaFamiglia(esito.scheda);
      if (domanda) {
        setFase({ fase: 'scegli_famiglia', parte, esito, domanda, ...(mostrate ? { viste: mostrate } : {}) });
        return;
      }
      if (esito.scheda.famiglia.id === 'libero') {
        setFase({ fase: 'fermo', parte, esito, messaggio: 'riconoscimento.errors.freePart' });
        return;
      }
      await costruisciCorrente.current(parte, esito);
    })();
    return () => {
      controllo.abort();
    };
  }, [chiave, giro]);

  const saltaVerifica = useCallback((): void => {
    verifica.current?.abort();
  }, []);

  useEffect(
    () => () => {
      for (const url of urls.current) {
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  const costruisci = useCallback((): void => {
    if (fase.fase !== 'conferma') {
      return;
    }
    statoVisita.scrivi(visita.current, { ...statoVisita.leggi(visita.current), confermata: true });
    setGiro((numero) => numero + 1);
  }, [fase]);
  const scegliFamiglia = useCallback(
    (famiglia: string): void => {
      if (fase.fase !== 'scegli_famiglia') {
        return;
      }
      if (famiglia === 'libero') {
        setFase({ fase: 'fermo', parte: fase.parte, esito: fase.esito, messaggio: 'riconoscimento.errors.freePart' });
        return;
      }
      void costruisciPezzo(fase.parte, fase.esito, famiglia === fase.esito.scheda.famiglia.id ? undefined : famiglia);
    },
    [costruisciPezzo, fase],
  );
  const riprova = useCallback((): void => {
    setGiro((numero) => numero + 1);
  }, []);
  const continuaSenzaViste = useCallback((): void => {
    senzaViste.current = true;
    setGiro((numero) => numero + 1);
  }, []);
  const rigeneraViste = useCallback((): void => {
    if (fase.fase !== 'non_combacia') {
      return;
    }
    // A new round: new request ids for the two views and the recognition. The button said what it costs.
    const stato = statoVisita.leggi(visita.current);
    statoVisita.scrivi(visita.current, { giro: stato.giro + 1, confermata: true });
    inSospeso.current = undefined;
    setGiro((numero) => numero + 1);
  }, [fase]);
  const confermaLeMisure = useCallback((): void => {
    const sospeso = inSospeso.current;
    if (fase.fase !== 'non_combacia' || sospeso === undefined) {
      return;
    }
    inSospeso.current = undefined;
    const { esito, ipotesi } = conIpotesi(sospeso.esito);
    setFase({
      fase: 'costruisco',
      parte: sospeso.parte,
      esito,
      ...(sospeso.famiglia === undefined ? {} : { famiglia: sospeso.famiglia }),
      viste: fase.viste,
    });
    void crea({ ...sospeso, esito, ipotesi });
  }, [conIpotesi, crea, fase]);
  const apriEsistente = useCallback((): void => {
    if (fase.fase !== 'esiste') {
      return;
    }
    const { modello } = fase;
    // The device's copy opens directly; otherwise the home opens the saved model from Sinopia (`?model=`).
    void navigate(
      modello.slugs === undefined ? `/?model=${encodeURIComponent(modello.modelId)}` : projectUrl(modello.slugs),
    );
  }, [fase, navigate]);
  const rifaiDaCapo = useCallback((): void => {
    rifai.current = true;
    rifacimenti.current += 1;
    setGiro((numero) => numero + 1);
  }, []);
  return {
    fase,
    costruisci,
    scegliFamiglia,
    riprova,
    continuaSenzaViste,
    rigeneraViste,
    confermaLeMisure,
    saltaVerifica,
    apriEsistente,
    rifaiDaCapo,
  };
}

/**
 * Le viste di un giro: la principale (riusata o generata), poi il controllo, scaricati e scontornati. Un errore che
 * permette di proseguire restituisce ciò che c'è (anche nulla); uno che ferma il flusso esce come {@link FermoViste}.
 */
async function ottieniViste(
  ingresso: Readonly<{
    parte: ParteVista;
    famiglia: string;
    riusata?: VistaRiusata;
    prova: Readonly<{ diversa: boolean }> | undefined;
    visita: string;
    giro: number;
    userId: string | undefined;
    segnale: AbortSignal;
    passo: (passo: 'principale' | 'controllo' | 'preparo', pronte: readonly VistaPronta[]) => void;
  }>,
): Promise<VistaPronta[]> {
  const { parte, famiglia, prova, visita, giro, segnale } = ingresso;
  const query = [parte.schedaParte.parte.colore, parte.schedaParte.parte.materiale, parte.schedaParte.parte.nome]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const prepara = async (vista: Omit<VistaPronta, 'maschera'>): Promise<VistaPronta> => {
    const maschera = await mascheraDellaVista(vista.immagine, strumentiBrowser, query);
    return maschera ? { ...vista, maschera: maschera.png } : vista;
  };
  if (prova) {
    ingresso.passo('principale', []);
    await aspetta(attesaProva);
    const disegnate = await visteProvaFibbia({ diversa: prova.diversa });
    const principale = await prepara({
      ruolo: 'principale',
      faccia: disegnate.principale.faccia,
      assetId: '00000000-0000-4000-8000-0000000000a1',
      immagine: disegnate.principale.immagine,
    });
    ingresso.passo('controllo', [principale]);
    await aspetta(attesaProva);
    const controllo = await prepara({
      ruolo: 'controllo',
      faccia: disegnate.controllo.faccia,
      assetId: '00000000-0000-4000-8000-0000000000a2',
      immagine: disegnate.controllo.immagine,
    });
    return [principale, controllo];
  }
  if (ingresso.userId === undefined) {
    return [];
  }
  const proprietario = { userId: ingresso.userId };
  const pronte: VistaPronta[] = [];
  /** Turn a view error into the page's decision: go on with what there is, or stop. */
  const gestisci = (errore: unknown): VistaPronta[] => {
    if (segnale.aborted || !(errore instanceof ErroreVista)) {
      throw errore;
    }
    const decisione = decisioneVista(errore);
    switch (decisione) {
      case 'senza_viste': {
        return pronte;
      }
      case 'crediti_insufficienti': {
        throw new FermoViste('riconoscimento.errors.insufficientCreditsViews', { riprova: true });
      }
      case 'riconferma_prezzo': {
        throw new FermoViste('riconoscimento.errors.unavailable', { riprova: true, riconferma: true });
      }
      case 'riprova': {
        throw new FermoViste('riconoscimento.generatedViews.inProgress', { riprova: true });
      }
      case 'riprova_o_senza': {
        throw new FermoViste('riconoscimento.generatedViews.unavailable', { riprova: true, senzaViste: true });
      }
      case 'accesso': {
        throw new FermoViste('riconoscimento.errors.restricted', { riprova: false });
      }
    }
  };
  let principale: Readonly<{ assetId: string; faccia: string }>;
  try {
    ingresso.passo('principale', pronte);
    if (ingresso.riusata) {
      const immagine = await scaricaVista(ingresso.riusata, proprietario);
      principale = ingresso.riusata;
      pronte.push(
        await prepara({
          ruolo: 'principale',
          faccia: principale.faccia,
          assetId: principale.assetId,
          immagine,
          riusata: true,
        }),
      );
    } else {
      const generata = await vistaUnaVolta(chiaveVista(visita, giro, 'principale'), async (requestId) =>
        generaVista({ ruolo: 'principale', famiglia, schedaParte: parte.schedaParte }, { requestId, segnale }),
      );
      principale = generata;
      pronte.push(
        await prepara({
          ruolo: 'principale',
          faccia: generata.faccia,
          assetId: generata.assetId,
          immagine: await scaricaVista(generata, proprietario),
        }),
      );
    }
  } catch (error) {
    return gestisci(error);
  }
  try {
    ingresso.passo('controllo', pronte);
    const controllo = await vistaUnaVolta(chiaveVista(visita, giro, 'controllo'), async (requestId) =>
      generaVista(
        {
          ruolo: 'controllo',
          famiglia,
          schedaParte: parte.schedaParte,
          principale: { assetId: principale.assetId },
        },
        { requestId, segnale },
      ),
    );
    ingresso.passo('preparo', pronte);
    pronte.push(
      await prepara({
        ruolo: 'controllo',
        faccia: controllo.faccia,
        assetId: controllo.assetId,
        immagine: await scaricaVista(controllo, proprietario),
      }),
    );
  } catch (error) {
    return gestisci(error);
  }
  return pronte;
}
