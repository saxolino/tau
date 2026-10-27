import { useEffect, useMemo, useState } from 'react';
import { useSelector } from '@xstate/react';
import type { ParameterManifest } from '@taucad/parameters';
import { famiglie } from '@taucad/smlib/famiglie';
import type { Esito, FamigliaQualsiasi, ParametriAnnidati } from '@taucad/smlib/famiglie';
import { normalizzati } from '@taucad/smlib/varianti';
import type { Correzione, ValutatoreVarianti } from '@taucad/smlib/varianti';
import { getActiveGroupValues } from '@taucad/types';
import type { FileParameterEntry, GeometryComponentNode } from '@taucad/types';
import type { PieceMaterialChoice } from '@taucad/viewer/cad/piece-materials';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useProject } from '#hooks/use-project.js';
import { chiaviFoglia, famigliaDalMain, ipotesiAperte, parametriEffettivi } from '#lib/assistant-brief.js';
import type { FamigliaProgetto } from '#lib/assistant-brief.js';
import { modelPieces } from '#lib/piece-measures.js';
import { useProjectParametersSource } from '#routes/w.$workspace.$project/chat-parameters.js';
import { leggiRecordRiconoscimento, percorsoRiconoscimento } from '#services/riconoscimento-record.js';

/** The checks of a family model: none (a free model), running, unavailable, or done. */
export type ControlloModello =
  | Readonly<{ stato: 'nessuno' }>
  | Readonly<{ stato: 'caricamento' }>
  | Readonly<{ stato: 'errore' }>
  | Readonly<{ stato: 'pronto'; esiti: readonly Esito[]; correzioni: readonly Correzione[] }>;

/** What the assistant knows about the open model. */
export type ModelloAssistente = Readonly<{
  pieces: readonly GeometryComponentNode[];
  materials: Readonly<Record<string, PieceMaterialChoice>>;
  nome: string;
  entryPath: string;
  manifest?: ParameterManifest;
  entry?: FileParameterEntry;
  /** The active group's values: what the designer (or the assistant, on a click) fixed. */
  valori: Readonly<Record<string, unknown>>;
  famiglia?: Readonly<{ definizione: FamigliaQualsiasi; variante: string; parametri: ParametriAnnidati }>;
  /** Dotted paths of the fixed values. */
  bloccati: readonly string[];
  ipotesi: number;
  riconoscimento?: Readonly<{ iou?: number }>;
  controllo: ControlloModello;
}>;

/** A quiet moment before checking new values: dragging a measure does not start a build per frame. */
const attesaControllo = 350;

const decoder = new TextDecoder();

/**
 * Gather what the assistant says first about the open model: its pieces and picked materials, the family its
 * `main.ts` declares and the values it is built with, the open assumptions, the recognition's silhouette match, and
 * the manufacturability checks of the variants worker (with the corrections that clear them).
 *
 * @param valutatore - The variants worker, or undefined where there is none (no checks then).
 * @returns The model as the assistant sees it.
 */
export function useAssistantModel(valutatore: ValutatoreVarianti | undefined): ModelloAssistente {
  const { projectId, mainEntryPath, modelInteractionRef, projectRef } = useProject();
  const { parameterFiles } = useFileManager();
  const source = useProjectParametersSource();
  const { manifest, entry } = source.useEntry(mainEntryPath);
  const nome = useSelector(projectRef, (state) => state.context.project?.name) ?? '';
  const context = useSelector(modelInteractionRef, (state) => state.context);
  const pieces = useMemo(
    () => context.unitOrder.flatMap((id) => modelPieces(context.unitsById[id]?.manifest)),
    [context.unitOrder, context.unitsById],
  );
  const materials = useMemo(
    () =>
      Object.fromEntries(
        context.unitOrder.flatMap((id) => Object.entries(context.unitsById[id]?.materialByComponentId ?? {})),
      ),
    [context.unitOrder, context.unitsById],
  );
  const root = `/projects/${projectId}`;
  const revisione = manifest?.revision;
  const [dichiarata, setDichiarata] = useState<FamigliaProgetto>();
  const [riconoscimento, setRiconoscimento] = useState<{ iou?: number }>();

  // The family and the recognition are files of the project: read again whenever the model was rebuilt.
  useEffect(() => {
    const corsa = { viva: true };
    // async-iife: bootstrap -- an absent or unreadable file says nothing; the card falls back to a free model.
    void (async (): Promise<void> => {
      try {
        const mainPath = `${root}/${mainEntryPath}`;
        const main = (await parameterFiles.exists(mainPath))
          ? decoder.decode(await parameterFiles.readFile(mainPath))
          : '';
        const recordPath = `${root}/${percorsoRiconoscimento}`;
        const record = (await parameterFiles.exists(recordPath))
          ? await parameterFiles.readFile(recordPath)
          : undefined;
        const lettura = leggiRecordRiconoscimento(record);
        if (corsa.viva) {
          setDichiarata(famigliaDalMain(main));
          setRiconoscimento(
            lettura.stato === 'ok'
              ? lettura.record.verifica.stato === 'fatta'
                ? { iou: lettura.record.verifica.iou }
                : {}
              : undefined,
          );
        }
      } catch (error) {
        console.error('Failed to read the model for the assistant:', error);
      }
    })();
    return () => {
      corsa.viva = false;
    };
  }, [mainEntryPath, parameterFiles, revisione, root]);

  const valori = useMemo(() => getActiveGroupValues(entry), [entry]);
  const definizione = dichiarata ? famiglie[dichiarata.id] : undefined;
  const famiglia = useMemo(
    () =>
      definizione && dichiarata && manifest
        ? {
            definizione,
            variante: dichiarata.variante,
            parametri: normalizzati(definizione, parametriEffettivi(manifest.defaults, valori), dichiarata.variante),
          }
        : undefined,
    [definizione, dichiarata, manifest, valori],
  );
  const schema = manifest?.legacyProjection.status === 'usable' ? manifest.legacyProjection.schema : undefined;
  const ipotesi = useMemo(() => ipotesiAperte(schema, valori), [schema, valori]);
  const bloccati = useMemo(() => chiaviFoglia(valori), [valori]);

  const [controllo, setControllo] = useState<ControlloModello>({ stato: 'nessuno' });
  const impronta = famiglia ? JSON.stringify([famiglia.definizione.id, famiglia.variante, famiglia.parametri]) : '';
  useEffect(() => {
    if (!famiglia || !valutatore) {
      // oxlint-disable-next-line react/set-state-in-effect -- a free model has no checks; the state follows the model.
      setControllo({ stato: 'nessuno' });
      return undefined;
    }
    const corsa = { viva: true };
    setControllo((prima) => (prima.stato === 'pronto' ? prima : { stato: 'caricamento' }));
    const attesa = setTimeout(() => {
      // async-iife: bootstrap -- debounced check; a newer model wins: an older answer is dropped, never shown over a newer one.
      void (async (): Promise<void> => {
        try {
          const esito = await valutatore.controlla({
            famiglia: famiglia.definizione.id,
            variante: famiglia.variante,
            parametri: famiglia.parametri,
          });
          if (corsa.viva) {
            setControllo({ stato: 'pronto', esiti: esito.esiti, correzioni: esito.correzioni });
          }
        } catch (error) {
          console.error('The manufacturability check failed:', error);
          if (corsa.viva) {
            setControllo({ stato: 'errore' });
          }
        }
      })();
    }, attesaControllo);
    return () => {
      corsa.viva = false;
      clearTimeout(attesa);
    };
    // A new object with equal values checks nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fingerprint stands for the family and its values.
  }, [impronta, valutatore]);

  return useMemo(
    () => ({
      pieces,
      materials,
      nome,
      entryPath: mainEntryPath,
      ...(manifest ? { manifest } : {}),
      ...(entry ? { entry } : {}),
      valori,
      ...(famiglia ? { famiglia } : {}),
      bloccati,
      ipotesi,
      ...(riconoscimento ? { riconoscimento } : {}),
      controllo,
    }),
    [
      bloccati,
      controllo,
      entry,
      famiglia,
      ipotesi,
      mainEntryPath,
      manifest,
      materials,
      nome,
      pieces,
      riconoscimento,
      valori,
    ],
  );
}
