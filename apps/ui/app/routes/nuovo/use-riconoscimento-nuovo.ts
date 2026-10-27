import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { domandaFamiglia, mappaLibreria, mappaPartType, risolviFamiglia } from '@taucad/smlib/riconoscimento';
import type { DomandaFamiglia } from '@taucad/smlib/riconoscimento';
import { useProjectManager } from '#hooks/use-project-manager.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import { sinopiaStarterKernelId } from '#lib/sinopia-engines.js';
import { homeProjectCreationLocation } from '#types/project-creation-location.types.js';
import { projectUrl } from '#utils/project-url.utils.js';
import { caricaProvaFibbia } from '#routes/nuovo/prova-fibbia.js';
import { preparaImmaginiRiconoscimento, strumentiBrowser } from '#services/riconoscimento-immagini.js';
import { progettoRiconosciuto } from '#services/riconoscimento-progetto.js';
import { caricaSchedaParte, ErroreParte } from '#services/sinopia-parts.js';
import type { LetturaNuovo, ParteCaricata } from '#services/sinopia-parts.js';
import { ErroreRiconoscimento, riconosciParte, riconoscimentoRegistrato } from '#services/sinopia-recognize.js';
import type { EsitoRiconoscimento } from '#services/sinopia-recognize.js';

/**
 * The flow of «/cad/nuovo»: read the part from Sinopia, recognise it, ask the family when the recognition is unsure,
 * then build the piece and open it. Each step shows on the page; a failure says how to go on.
 */

/** The part as the page shows it: the sheet, and object URLs of the picture and the mask. */
export type ParteVista = ParteCaricata & Readonly<{ immagineUrl: string; mascheraUrl: string; prova: boolean }>;

/** Where the flow stands. */
export type FaseNuovo =
  | Readonly<{ fase: 'leggo' }>
  | Readonly<{ fase: 'riconosco'; parte: ParteVista }>
  | Readonly<{ fase: 'scegli_famiglia'; parte: ParteVista; esito: EsitoRiconoscimento; domanda: DomandaFamiglia }>
  | Readonly<{ fase: 'costruisco'; parte: ParteVista; esito: EsitoRiconoscimento; famiglia?: string }>
  | Readonly<{ fase: 'fermo'; parte: ParteVista; esito?: EsitoRiconoscimento; messaggio: PlainMessageKey }>
  | Readonly<{ fase: 'errore'; parte?: ParteVista; messaggio: PlainMessageKey; riprova: boolean }>;

const messaggioParte: Record<ErroreParte['codice'], PlainMessageKey> = {
  progettoAssente: 'riconoscimento.errors.projectMissing',
  immagineAssente: 'riconoscimento.errors.imageMissing',
  partiAssenti: 'riconoscimento.errors.partsMissing',
  parteAssente: 'riconoscimento.errors.partMissing',
  mascheraAssente: 'riconoscimento.errors.maskMissing',
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
          : 'riconoscimento.errors.unavailable';

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
}> {
  const navigate = useNavigate();
  const projectManager = useProjectManager();
  const [fase, setFase] = useState<FaseNuovo>(
    lettura.stato === 'incompleto'
      ? { fase: 'errore', messaggio: 'riconoscimento.errors.incomplete', riprova: false }
      : { fase: 'leggo' },
  );
  const [giro, setGiro] = useState(0);
  const urls = useRef<string[]>([]);

  const costruisci = useCallback(
    async (parte: ParteVista, esito: EsitoRiconoscimento, famiglia?: string): Promise<void> => {
      setFase({ fase: 'costruisco', parte, esito, ...(famiglia === undefined ? {} : { famiglia }) });
      const progetto = progettoRiconosciuto({
        scheda: esito.scheda,
        schedaParte: parte.schedaParte,
        immagine: {
          bytes: new Uint8Array(await parte.immagine.arrayBuffer()),
          tipo: parte.immagine.type || 'image/png',
        },
        maschera: new Uint8Array(await parte.mascheraPng.arrayBuffer()),
        lingua,
        ...(famiglia === undefined ? {} : { famigliaScelta: famiglia }),
      });
      if (progetto === undefined) {
        setFase({ fase: 'fermo', parte, esito, messaggio: 'riconoscimento.errors.freePart' });
        return;
      }
      try {
        const creato = await projectManager.createProject({
          kernel: sinopiaStarterKernelId,
          projectName: progetto.nome,
          files: progetto.files,
          location: homeProjectCreationLocation,
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
  useEffect(() => {
    costruisciCorrente.current = costruisci;
    letturaCorrente.current = lettura;
  });
  const chiave = JSON.stringify(lettura);

  useEffect(() => {
    const lettura = letturaCorrente.current;
    if (lettura.stato === 'incompleto') {
      return;
    }
    const controllo = new AbortController();
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
            : await caricaSchedaParte(lettura.parametri, strumentiBrowser);
        const immagineUrl = URL.createObjectURL(caricata.immagine);
        const mascheraUrl = URL.createObjectURL(caricata.mascheraPng);
        urls.current.push(immagineUrl, mascheraUrl);
        parte = { ...caricata, immagineUrl, mascheraUrl, prova: lettura.stato === 'prova' };
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
  return { fase, scegliFamiglia, riprova };
}
