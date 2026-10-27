import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from '@xstate/react';
import { asKnownArtifact } from '@taucad/runtime';
import { getActiveGroupValues } from '@taucad/types';
import type { GeometryComponentNode } from '@taucad/types';
import type { Processo } from '@taucad/smlib/famiglie';
import { creaAnalizzatore, esitiProducibilita } from '@taucad/smlib/producibilita';
import type { Analizzatore, ControlloProducibilita, RispostaProducibilita } from '@taucad/smlib/producibilita';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import type { ProducibilityOverlay } from '@taucad/viewer/graphics/three/react/producibility-overlay.types';
import {
  deriveModelInteractionUnitId,
  getModelInteractionUnitState,
} from '@taucad/viewer/machines/model-interaction.machine';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useParameterSetActor, useProject } from '#hooks/use-project.js';
import {
  direzioniSformo,
  famigliaDalMain,
  parametriCorrenti,
  pezziProducibilita,
  sovrapposizioneControllo,
} from '#lib/producibilita.js';
import type { DirezioneSformo, FamigliaDelMain, PezzoProducibilita } from '#lib/producibilita.js';
import { modelPieces } from '#lib/piece-measures.js';
import {
  aggiungiScelta,
  leggiRecordProducibilita,
  percorsoProducibilita,
  recordVuoto,
  serializzaRecordProducibilita,
} from '#services/producibilita-record.js';
import type { RecordProducibilita, SceltaEsportazione } from '#services/producibilita-record.js';
import { bestRouteForActiveKernel, exportDocumentWithValidatedInput } from '#utils/export-formats.utils.js';

/**
 * The project's producibility checks (E1): one host per open project measures the model the kernel rendered last,
 * off the UI thread, and every reader (the inspector's «Producibilità», the soft block in Esporta, the viewer's veil,
 * the assistant) reads the same checks from here.
 *
 * The measure runs once the render settles (600 ms after the last change): the project's kernel exports the STEP it
 * would download (its own worker), a dedicated SMLib worker reads it back and measures it. Changing a process
 * recomputes the checks at once from the last measures (the thresholds are a pure function); the family's own checks
 * for the new process follow from the worker, which does not measure the geometry again.
 */

/** Where the checks stand. */
export type StatoProducibilita = 'inattivo' | 'in_corso' | 'pronto' | 'non_disponibile' | 'errore';

/**
 * The producibility of the open model, for every reader.
 */
export type Producibilita = Readonly<{
  stato: StatoProducibilita;
  /** The checks for the processes picked now, merged with the family's own. */
  controlli: readonly ControlloProducibilita[];
  /** The checks that block production. */
  blocchi: readonly ControlloProducibilita[];
  pezzi: readonly PezzoProducibilita[];
  direzione: DirezioneSformo;
  /** The rendering the checks were measured on; the viewer tints that one only. */
  artifactKey: string | undefined;
  /** Whether the checks describe the geometry on screen (false while a newer render waits for its measure). */
  aggiornati: boolean;
  famiglia: FamigliaDelMain | undefined;
  tempi: RispostaProducibilita['tempi'] | undefined;
  /** The check shown on the model. */
  focus: string | undefined;
  setFocus: (id: string | undefined) => void;
  setProcesso: (pezzo: string, processo: Processo) => void;
  setDirezione: (direzione: DirezioneSformo) => void;
  riprova: () => void;
  /** Write a choice made in front of the soft block of Esporta to the project's register. */
  registraScelta: (scelta: SceltaEsportazione, blocchi: readonly ControlloProducibilita[]) => Promise<void>;
}>;

const ProducibilitaContext = createContext<Producibilita | undefined>(undefined);

/** How long a settled render waits before it is measured (ms): a drag or a typed value settles first. */
const attesaMisura = 600;

const decoder = new TextDecoder();

/**
 * Read a project file, or undefined when it does not exist. The working copy's connection can be released while the
 * project mounts (an `AbortError`): the read is tried again a few times before it gives up.
 */
async function leggiFile(
  files: ReturnType<typeof useFileManager>['parameterFiles'],
  path: string,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  for (let tentativo = 0; ; tentativo++) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- one read, tried again only after the connection was released.
      return (await files.exists(path)) ? await files.readFile(path) : undefined;
    } catch (error) {
      if (signal.aborted || tentativo >= 4 || !(error instanceof Error) || error.name !== 'AbortError') {
        throw error;
      }
      // oxlint-disable-next-line no-await-in-loop -- wait for the connection to open again.
      await new Promise((resolve) => {
        setTimeout(resolve, 400);
      });
    }
  }
}

/** The worker of the checks, created at the first measure. */
const creaWorkerProducibilita = (): Worker =>
  new Worker(new URL('../../workers/producibilita.worker.ts', import.meta.url), { type: 'module' });

type Esito = Readonly<{ chiave: string; hash: string; risposta: RispostaProducibilita }>;

/**
 * Hosts the checks of the open project and provides them to the inspector, Esporta, the viewer and the assistant.
 *
 * @param props - The project's interface.
 * @returns The provider.
 */
export function ProducibilitaProvider({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  const { projectId, mainEntryPath, geometryUnits, modelInteractionRef, resolveParameterEntry } = useProject();
  const { parameterFiles } = useFileManager();
  const cadRef = geometryUnits.get(mainEntryPath);
  // The parameters the kernel evaluated: the model's defaults and the active group's values (as the Measures read them).
  const parameterManifest = useSelector(cadRef, (state) => state?.context.parameterManifest);
  const parameterActor = useParameterSetActor(mainEntryPath);
  const parameterEntry = useSelector(parameterActor, (state) => state?.context.current?.entry);
  useEffect(() => {
    if (
      parameterManifest &&
      parameterActor?.getSnapshot().context.current?.manifest.revision !== parameterManifest.revision
    ) {
      resolveParameterEntry(mainEntryPath, parameterManifest);
    }
  }, [parameterManifest, parameterActor, mainEntryPath, resolveParameterEntry]);
  const rendering = useSelector(cadRef, (state) => state?.context.rendering);
  const evaluation = useSelector(cadRef, (state) => state?.context.evaluation);
  const kernelId = useSelector(cadRef, (state) => state?.context.activeKernelId);
  const outcome = useSelector(cadRef, (state) => state?.context.latestRenderingOutcome);
  const unitId = deriveModelInteractionUnitId({ sourceFile: mainEntryPath });
  const materialiScelti = useSelector(
    modelInteractionRef,
    (state) => getModelInteractionUnitState(state.context, unitId).materialByComponentId,
  );
  const root = `/projects/${projectId}`;
  const recordPath = `${root}/${percorsoProducibilita}`;

  const [record, setRecord] = useState<RecordProducibilita>(recordVuoto);
  const [famiglia, setFamiglia] = useState<FamigliaDelMain>();
  const [esito, setEsito] = useState<Esito>();
  const [stato, setStato] = useState<StatoProducibilita>('inattivo');
  const [focus, setFocus] = useState<string>();
  const [tentativo, setTentativo] = useState(0);
  const analizzatore = useRef<Analizzatore | undefined>(undefined);
  useEffect(
    () => () => {
      analizzatore.current?.chiudi();
      analizzatore.current = undefined;
    },
    [],
  );

  // The record: processes and direction picked earlier, and the register of exports with blocks.
  useEffect(() => {
    const vita = new AbortController();
    // async-iife: bootstrap -- read the record once per project; an absent or unreadable one is empty.
    void (async (): Promise<void> => {
      try {
        const bytes = await leggiFile(parameterFiles, recordPath, vita.signal);
        if (!vita.signal.aborted) {
          setRecord(leggiRecordProducibilita(bytes));
        }
      } catch (error) {
        if (!vita.signal.aborted) {
          console.error('Failed to read the producibility record:', error);
        }
      }
    })();
    return () => {
      vita.abort();
    };
  }, [parameterFiles, recordPath]);

  const scriviRecord = useCallback(
    async (cambia: (record: RecordProducibilita) => RecordProducibilita): Promise<void> => {
      // Read again before writing: another tab may have written meanwhile.
      const attuali = (await parameterFiles.exists(recordPath)) ? await parameterFiles.readFile(recordPath) : undefined;
      const prossimo = cambia(leggiRecordProducibilita(attuali));
      const scritto = await parameterFiles.writeFileChecked({
        path: recordPath,
        data: serializzaRecordProducibilita(prossimo),
        preconditions: [{ path: recordPath, expected: attuali ?? null }],
      });
      if (scritto.status === 'conflict') {
        throw new Error('Producibility record changed meanwhile');
      }
      setRecord(prossimo);
    },
    [parameterFiles, recordPath],
  );

  // The family the main file declares, read again with every new evaluation (the file may have been rewritten).
  const evaluationId = evaluation?.success ? evaluation.id : undefined;
  useEffect(() => {
    const vita = new AbortController();
    // async-iife: bootstrap -- the main file names its family; a model not built from one has none.
    void (async (): Promise<void> => {
      let letta: FamigliaDelMain | undefined;
      try {
        const bytes = await leggiFile(parameterFiles, `${root}/${mainEntryPath}`, vita.signal);
        letta = bytes ? famigliaDalMain(decoder.decode(bytes)) : undefined;
      } catch (error) {
        // A file that cannot be read names no family; the evaluation it followed is the failure's context.
        console.error('Failed to read the family the main file declares:', error, { evaluationId });
        letta = undefined;
      }
      if (!vita.signal.aborted) {
        setFamiglia(letta);
      }
    })();
    return () => {
      vita.abort();
    };
  }, [parameterFiles, root, mainEntryPath, evaluationId]);

  const parametriFamiglia = useMemo(
    () => (famiglia ? parametriCorrenti(parameterManifest?.defaults, getActiveGroupValues(parameterEntry)) : undefined),
    [famiglia, parameterManifest, parameterEntry],
  );

  // The pieces of the settled render, as the export reads them.
  const settled = rendering?.success === true && !rendering.transient && outcome === 'success' ? rendering : undefined;
  const hash = settled && kernelId === 'smlib' ? settled.hash : undefined;
  const nodi = useMemo((): GeometryComponentNode[] => {
    const artifact = settled ? asKnownArtifact(settled.artifact) : undefined;
    if (artifact?.mimeType !== 'model/gltf-binary') {
      return [];
    }
    try {
      return modelPieces(buildGltfComponentManifest(artifact.content));
    } catch {
      return [];
    }
  }, [settled]);
  const pezzi = useMemo(
    () =>
      pezziProducibilita({
        nodi,
        materialiScelti,
        processiScelti: record.processi,
        ...(famiglia ? { famiglia: { parametri: parametriFamiglia } } : {}),
      }),
    [nodi, materialiScelti, record.processi, famiglia, parametriFamiglia],
  );
  const { direzione } = record;
  const processoFamiglia = pezzi.find((pezzo) => !pezzo.pietra)?.processo;
  const chiave =
    hash === undefined || nodi.length === 0
      ? undefined
      : JSON.stringify([
          hash,
          pezzi.map(({ nome, processo, materiale, pietra }) => [nome, processo, materiale ?? '', pietra]),
          direzione,
          famiglia?.id,
          famiglia?.variante,
          parametriFamiglia,
        ]);

  const richiesta = useRef({ pezzi, direzione, famiglia, parametriFamiglia, processoFamiglia, hash });
  // The measure reads the request when its timer fires; the effect below runs after this one.
  useLayoutEffect(() => {
    richiesta.current = { pezzi, direzione, famiglia, parametriFamiglia, processoFamiglia, hash };
  });

  useEffect(() => {
    if (chiave === undefined) {
      // oxlint-disable-next-line react/set-state-in-effect -- The checks follow the kernel and the render they read.
      setStato(kernelId !== undefined && kernelId !== 'smlib' ? 'non_disponibile' : 'inattivo');
      return undefined;
    }
    setStato('in_corso');
    const controller = new AbortController();
    const { signal } = controller;
    // A call, so the checks after each await read the signal again.
    const fermata = (): boolean => signal.aborted;
    const misura = async (): Promise<void> => {
      const attuale = richiesta.current;
      const context = cadRef?.getSnapshot().context;
      const corrente = context?.rendering;
      if (!context?.document || !context.kernelClient || !corrente?.success || corrente.hash !== attuale.hash) {
        return;
      }
      const route = bestRouteForActiveKernel(context.kernelClient, 'step', 'smlib');
      if (route?.kernelId !== 'smlib') {
        setStato('non_disponibile');
        return;
      }
      const esportato = await exportDocumentWithValidatedInput(context.document, route, {
        signal,
        options: { coordinateSystem: 'z-up' },
      });
      if (fermata()) {
        return;
      }
      const step = esportato.success ? esportato.files.at(0)?.bytes : undefined;
      if (!esportato.success || !step || esportato.evaluationId !== corrente.evaluationId) {
        setStato(esportato.success ? 'in_corso' : 'errore');
        return;
      }
      analizzatore.current ??= creaAnalizzatore(creaWorkerProducibilita);
      const risposta = await analizzatore.current.analizza(
        {
          step,
          pezzi: attuale.pezzi.map(({ nome, processo, materiale, pietra }) => ({
            nome,
            processo,
            ...(materiale === undefined ? {} : { materiale }),
            ...(pietra ? { pietra } : {}),
          })),
          direzione: direzioniSformo[attuale.direzione],
          ...(attuale.famiglia
            ? {
                famiglia: {
                  id: attuale.famiglia.id,
                  variante: attuale.famiglia.variante,
                  ...(attuale.parametriFamiglia === undefined ? {} : { parametri: attuale.parametriFamiglia }),
                  ...(attuale.processoFamiglia === undefined ? {} : { processo: attuale.processoFamiglia }),
                },
              }
            : {}),
        },
        { signal },
      );
      if (!fermata()) {
        setEsito({ chiave, hash: corrente.hash, risposta });
        setStato('pronto');
      }
    };
    const timer = setTimeout(() => {
      // async-iife: bootstrap -- the measure runs once the render settled; its failure is the section's state.
      void (async (): Promise<void> => {
        try {
          await misura();
        } catch (error) {
          if (!fermata()) {
            // «Riprova» (`tentativo`) is what restarts this check, so a failure names it.
            console.error('Producibility check failed:', error, { tentativo });
            setStato('errore');
          }
        }
      })();
    }, attesaMisura);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [chiave, tentativo, cadRef, kernelId]);

  // The checks for the processes on screen: the thresholds are pure, so a new process shows at once; the family's
  // own checks join once the worker has them for that process.
  const controlli = useMemo((): readonly ControlloProducibilita[] => {
    if (!esito) {
      return [];
    }
    const { risposta } = esito;
    return esitiProducibilita(
      risposta.misure,
      pezzi.map(({ nome, processo, materiale, pietra }) => ({
        nome,
        processo,
        ...(materiale === undefined ? {} : { materiale }),
        ...(pietra ? { pietra } : {}),
      })),
      { esitiFamiglia: risposta.processoFamiglia === processoFamiglia ? risposta.esitiFamiglia : [] },
    );
  }, [esito, pezzi, processoFamiglia]);
  const blocchi = useMemo(() => controlli.filter(({ livello }) => livello === 'blocco'), [controlli]);

  /** Apply a change at once and write it to the record; a failed write keeps the change for this session. */
  const cambiaRecord = useCallback(
    (cambia: (record: RecordProducibilita) => RecordProducibilita) => {
      setRecord(cambia);
      // async-iife: bootstrap -- the record follows the choice; the choice does not wait for the file.
      void (async (): Promise<void> => {
        try {
          await scriviRecord(cambia);
        } catch (error) {
          console.error('Failed to save the producibility record:', error);
        }
      })();
    },
    [scriviRecord],
  );
  const setProcesso = useCallback(
    (pezzo: string, processo: Processo) => {
      cambiaRecord((attuale) => ({ ...attuale, processi: { ...attuale.processi, [pezzo]: processo } }));
    },
    [cambiaRecord],
  );
  const setDirezione = useCallback(
    (prossima: DirezioneSformo) => {
      cambiaRecord((attuale) => ({ ...attuale, direzione: prossima }));
    },
    [cambiaRecord],
  );
  const riprova = useCallback(() => {
    setTentativo((valore) => valore + 1);
  }, []);
  const registraScelta = useCallback(
    async (scelta: SceltaEsportazione, elenco: readonly ControlloProducibilita[]) =>
      scriviRecord((attuale) =>
        aggiungiScelta(attuale, {
          scelta,
          processi: Object.fromEntries(
            pezzi.filter(({ pietra }) => !pietra).map(({ nome, processo }) => [nome, processo]),
          ),
          blocchi: elenco,
          quando: new Date(),
        }),
      ),
    [pezzi, scriviRecord],
  );

  const value = useMemo(
    (): Producibilita => ({
      stato,
      controlli,
      blocchi,
      pezzi,
      direzione,
      artifactKey: esito?.hash,
      aggiornati: esito !== undefined && esito.hash === hash,
      famiglia,
      tempi: esito?.risposta.tempi,
      focus,
      setFocus,
      setProcesso,
      setDirezione,
      riprova,
      registraScelta,
    }),
    [
      stato,
      controlli,
      blocchi,
      pezzi,
      direzione,
      esito,
      hash,
      famiglia,
      focus,
      setProcesso,
      setDirezione,
      riprova,
      registraScelta,
    ],
  );
  return <ProducibilitaContext.Provider value={value}>{children}</ProducibilitaContext.Provider>;
}

/**
 * The open model's producibility, or undefined outside a project page (shared and preview pages carry none). The
 * assistant reads `controlli` and `blocchi` from here; `esitiProducibilita` of `@taucad/smlib/producibilita` is the
 * same rule as a pure function.
 *
 * @returns The checks and their controls.
 */
export function useProducibilita(): Producibilita | undefined {
  return useContext(ProducibilitaContext);
}

/**
 * The veil the viewer draws for the check in focus, for the artifact it was measured on.
 *
 * @returns The overlay, or undefined.
 */
export function useProducibilityOverlay(): ProducibilityOverlay | undefined {
  const producibilita = useProducibilita();
  const controllo = producibilita?.controlli.find(({ id }) => id === producibilita.focus);
  const pezzi = producibilita?.pezzi;
  const direzione = producibilita?.direzione ?? 'z';
  const artifactKey = producibilita?.artifactKey;
  return useMemo(
    () => (pezzi ? sovrapposizioneControllo({ controllo, pezzi, direzione, artifactKey }) : undefined),
    [controllo, pezzi, direzione, artifactKey],
  );
}

/** The context, for tests that render a reader with a fixed value. */
export const ProducibilitaTestProvider = ProducibilitaContext.Provider;
