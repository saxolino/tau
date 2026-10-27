import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  catalogoFamiglie,
  domandaFamiglia,
  mappaLibreria,
  mappaPartType,
  risolviFamiglia,
} from '@taucad/smlib/riconoscimento';
import type { DomandaFamiglia, SchedaRiconoscimento } from '@taucad/smlib/riconoscimento';
import { useProjectManager } from '#hooks/use-project-manager.js';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import { sinopiaStarterKernelId } from '#lib/sinopia-engines.js';
import { homeProjectCreationLocation } from '#types/project-creation-location.types.js';
import { projectUrl } from '#utils/project-url.utils.js';
import { caricaProvaFibbia } from '#routes/nuovo/prova-fibbia.js';
import { preparaImmaginiRiconoscimento, strumentiBrowser } from '#services/riconoscimento-immagini.js';
import type { ImmaginiRiconoscimento } from '#services/riconoscimento-immagini.js';
import { eseguiPipelineRiconoscimento } from '#services/riconoscimento-pipeline.js';
import { progettoRiconosciuto } from '#services/riconoscimento-progetto.js';
import type { RecordRiconoscimento } from '#services/riconoscimento-record.js';
import { creaVerificatoreBrowser } from '#services/riconoscimento-verifica.js';
import { caricaSchedaParte, ErroreParte } from '#services/sinopia-parts.js';
import { caricaSchedaPezzo } from '#services/sinopia-pezzo.js';
import type { LetturaNuovo, ParteCaricata } from '#services/sinopia-parts.js';
import { ErroreRiconoscimento, riconosciParte, riconoscimentoRegistrato } from '#services/sinopia-recognize.js';
import type { EsitoRiconoscimento } from '#services/sinopia-recognize.js';
import { readSinopiaCadLink } from '#services/sinopia-cad.js';
import { cercaModelloEsistente } from '#services/sinopia-modello-esistente.js';
import type { ModelloEsistente, OrigineSinopia } from '#services/sinopia-modello-esistente.js';

/**
 * The flow of «/cad/nuovo»: read the part from Sinopia, recognise it, ask the family when the recognition is unsure,
 * check the piece against the mask (D3: the silhouette, the best of two rounds), then build it and open it. Each step
 * shows on the page; a failure says how to go on. Stopping the check (Esc, «Salta la verifica», leaving the page) ends
 * its worker; the piece is then built from the recognition alone, said so in its record.
 */

/**
 * The part as the page shows it: the sheet, object URLs of the picture and the mask, and, for a part of a Sinopia
 * project, where it comes from (the model will belong to that project, with that image and part as its origin).
 */
export type ParteVista = ParteCaricata &
  Readonly<{ immagineUrl: string; mascheraUrl: string; prova: boolean; origine?: OrigineSinopia }>;

/** Where the flow stands. */
export type FaseNuovo =
  | Readonly<{ fase: 'leggo' }>
  | Readonly<{ fase: 'riconosco'; parte: ParteVista }>
  /** The part already became a model: open it, or build it again from scratch (only on request: it costs again). */
  | Readonly<{ fase: 'esiste'; parte: ParteVista; modello: ModelloEsistente }>
  | Readonly<{ fase: 'scegli_famiglia'; parte: ParteVista; esito: EsitoRiconoscimento; domanda: DomandaFamiglia }>
  | Readonly<{ fase: 'verifico'; parte: ParteVista; esito: EsitoRiconoscimento; famiglia?: string }>
  | Readonly<{
      fase: 'costruisco';
      parte: ParteVista;
      esito: EsitoRiconoscimento;
      famiglia?: string;
      /** The check's IoU, when it was made. */
      iou?: number;
    }>
  | Readonly<{ fase: 'fermo'; parte: ParteVista; esito?: EsitoRiconoscimento; messaggio: PlainMessageKey }>
  | Readonly<{ fase: 'errore'; parte?: ParteVista; messaggio: PlainMessageKey; riprova: boolean }>;

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
    : errore.codice === 'BILLING_ACCOUNT_RESTRICTED'
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

/**
 * Run the flow for the address read by the route.
 *
 * @param lettura - What the address asks for.
 * @param lingua - The interface language (the reasons the recognition writes).
 * @returns The current step, how to answer the family question, and how to try again.
 */
export function useRiconoscimentoNuovo(
  lettura: LetturaNuovo,
  lingua: 'it' | 'en',
): Readonly<{
  fase: FaseNuovo;
  scegliFamiglia: (famiglia: string) => void;
  riprova: () => void;
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
  const [fase, setFase] = useState<FaseNuovo>(
    lettura.stato === 'incompleto'
      ? { fase: 'errore', messaggio: 'riconoscimento.errors.incomplete', riprova: false }
      : { fase: 'leggo' },
  );
  const [giro, setGiro] = useState(0);
  const urls = useRef<string[]>([]);
  /** The flow's own controller (the page going away) and the check's (Esc / «Salta la verifica»). */
  const flusso = useRef<AbortController | undefined>(undefined);
  const verifica = useRef<AbortController | undefined>(undefined);
  /** The two pictures the recognition took, for the second round. */
  const immaginiRientro = useRef<ImmaginiRiconoscimento | undefined>(undefined);

  const costruisci = useCallback(
    async (parte: ParteVista, esito: EsitoRiconoscimento, famiglia?: string): Promise<void> => {
      const maschera = new Uint8Array(await parte.mascheraPng.arrayBuffer());
      const segno = (famiglia === undefined ? {} : { famiglia }) as { famiglia?: string };
      setFase({ fase: 'verifico', parte, esito, ...segno });
      // The check: the machine of the pipeline with the real clients. A stop, a failure or a part now said free-form
      // never keeps the piece from opening: it is built from the recognition, and the record says why.
      const controlloVerifica = new AbortController();
      verifica.current = controlloVerifica;
      const verificatore = creaVerificatoreBrowser();
      const segnale = flusso.current
        ? AbortSignal.any([flusso.current.signal, controlloVerifica.signal])
        : controlloVerifica.signal;
      const risultato = await eseguiPipelineRiconoscimento({
        scheda: schedaPerVerifica(esito.scheda, famiglia),
        maschera,
        progettoId: parte.schedaParte.progetto.id,
        parteId: parte.schedaParte.parte.id,
        verificatore,
        rientro: async ({ scheda, differenzaPng, testo, iou }) => {
          if (parte.prova || immaginiRientro.current === undefined) {
            return scheda;
          }
          const seconda = await riconosciParte(
            {
              schedaParte: parte.schedaParte,
              immagini: immaginiRientro.current,
              lingua,
              rientro: { differenzaPng, testo, iou },
            },
            { segnale },
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
      const verificaRecord: RecordRiconoscimento['verifica'] = verificata
        ? risultato.verifica
        : { stato: 'non_disponibile', motivo: risultato.tipo === 'fermata' ? 'saltata' : 'errore' };
      const schedaFinale = verificata ? risultato.scheda : esito.scheda;
      const esitoFinale = { ...esito, scheda: schedaFinale };
      setFase({
        fase: 'costruisco',
        parte,
        esito: esitoFinale,
        ...segno,
        ...(verificata ? { iou: risultato.verifica.iou } : {}),
      });
      const progetto = progettoRiconosciuto({
        scheda: schedaFinale,
        schedaParte: parte.schedaParte,
        immagine: {
          bytes: new Uint8Array(await parte.immagine.arrayBuffer()),
          tipo: parte.immagine.type || 'image/png',
        },
        maschera,
        lingua,
        verifica: verificaRecord,
        ...(famiglia === undefined ? {} : { famigliaScelta: famiglia }),
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

  // The flow runs once per address and per «Riprova»: the identity of the callbacks must not restart it.
  const costruisciCorrente = useRef(costruisci);
  const letturaCorrente = useRef(lettura);
  const utenteCorrente = useRef(userId);
  const projectManagerCorrente = useRef(projectManager);
  const recordFilesCorrenti = useRef(recordFiles);
  useEffect(() => {
    costruisciCorrente.current = costruisci;
    letturaCorrente.current = lettura;
    utenteCorrente.current = userId;
    projectManagerCorrente.current = projectManager;
    recordFilesCorrenti.current = recordFiles;
  });
  const chiave = JSON.stringify(lettura);

  useEffect(() => {
    const lettura = letturaCorrente.current;
    if (lettura.stato === 'incompleto') {
      return;
    }
    const controllo = new AbortController();
    flusso.current = controllo;
    const { signal } = controllo;
    /* Read at each step: the page may have gone away while the step awaited. */
    const annullato = (): boolean => signal.aborted;
    // async-iife: bootstrap -- the flow of one visit, abandoned when the page goes away.
    void (async (): Promise<void> => {
      setFase({ fase: 'leggo' });
      let parte: ParteVista;
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
          messaggio: error instanceof ErroreParte ? messaggioParte[error.codice] : 'riconoscimento.errors.unavailable',
          riprova: !(error instanceof ErroreParte),
        });
        return;
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
      // Before the recognition (which costs): a part that already became a model is reopened, not rebuilt.
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
      setFase({ fase: 'riconosco', parte });
      let esito: EsitoRiconoscimento;
      try {
        if (parte.prova) {
          await new Promise((resolve) => {
            setTimeout(resolve, attesaProva);
          });
          esito = riconoscimentoRegistrato({ famigliaIncerta: lettura.stato === 'prova' && lettura.famigliaIncerta });
        } else {
          const immagini = await preparaImmaginiRiconoscimento(
            parte.immagine,
            parte.maschera,
            parte.schedaParte.parte.box,
          );
          immaginiRientro.current = immagini;
          esito = await riconosciParte({ schedaParte: parte.schedaParte, immagini, lingua }, { segnale: signal });
        }
      } catch (error) {
        if (annullato()) {
          return;
        }
        console.error('Recognition failed:', error);
        setFase({
          fase: 'errore',
          parte,
          messaggio:
            error instanceof ErroreRiconoscimento
              ? messaggioRiconoscimento(error)
              : 'riconoscimento.errors.unavailable',
          riprova: !(error instanceof ErroreRiconoscimento && error.codice === 'BILLING_ACCOUNT_RESTRICTED'),
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
        setFase({ fase: 'scegli_famiglia', parte, esito, domanda });
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
  }, [chiave, giro, lingua]);

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

  const scegliFamiglia = useCallback(
    (famiglia: string): void => {
      if (fase.fase !== 'scegli_famiglia') {
        return;
      }
      if (famiglia === 'libero') {
        setFase({ fase: 'fermo', parte: fase.parte, esito: fase.esito, messaggio: 'riconoscimento.errors.freePart' });
        return;
      }
      void costruisci(fase.parte, fase.esito, famiglia === fase.esito.scheda.famiglia.id ? undefined : famiglia);
    },
    [costruisci, fase],
  );
  const riprova = useCallback((): void => {
    setGiro((numero) => numero + 1);
  }, []);
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
    setGiro((numero) => numero + 1);
  }, []);
  return { fase, scegliFamiglia, riprova, saltaVerifica, apriEsistente, rifaiDaCapo };
}
