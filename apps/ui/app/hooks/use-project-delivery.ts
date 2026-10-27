import { useEffect, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { getActiveGroupValues } from '@taucad/types';
import type { GeometryComponentNode } from '@taucad/types';
import { creaConsegna } from '@taucad/smlib/consegna';
import { famiglie } from '@taucad/smlib/famiglie';
import {
  deriveModelInteractionUnitId,
  getModelInteractionUnitState,
} from '@taucad/viewer/machines/model-interaction.machine';
import { useParameterSetActor, useProject } from '#hooks/use-project.js';
import { useSinopiaSendEvents } from '#hooks/use-sinopia-send-events.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import { groupPieceMeasures, pieceKeyValue } from '#lib/piece-measures.js';
import { pieceWeight } from '#lib/piece-weight.js';
import { materialiGlb, pezziDellaConsegna, pezziPerIlWorker, righeControlli, righeMisure } from '#lib/consegna.js';
import type { PezzoDellaConsegna } from '#lib/consegna.js';
import { useProducibilita } from '#routes/w.$workspace.$project/producibilita-context.js';
import { nomeControllo, valoreControllo } from '#routes/w.$workspace.$project/inspector-producibilita.js';
import type { ProjectDelivery } from '#services/project-export.js';
import { isTipoPezzo } from '#services/sinopia-consegna.js';
import type { TipoPezzo } from '#services/sinopia-consegna.js';
import type { TestiTavola } from '#services/tavola-pdf.js';
import { convertIgesInBrowser } from '#workers/project-export.client.js';

/** The delivery worker (SMLib), created at the first request. */
const creaWorkerConsegna = (): Worker =>
  new Worker(new URL('../workers/consegna.worker.ts', import.meta.url), { type: 'module' });

/**
 * SinopiaCAD's delivery bound to the open project (E3a): the delivery worker, each piece's material, process and
 * weight, and everything the PDF sheet writes besides its drawings. Esporta and «Invia a Sinopia» read it through
 * `useProjectExport`.
 *
 * @param pieces - The pieces of the settled render, as the export reads them.
 * @returns The delivery for the export source, the pieces, the family's part type.
 */
export function useProjectDelivery(pieces: readonly GeometryComponentNode[]): {
  delivery: ProjectDelivery;
  pezzi: readonly PezzoDellaConsegna[];
  partType: TipoPezzo | undefined;
} {
  const { t, language } = useTranslation();
  const { projectRef, projectId, mainEntryPath, geometryUnits, modelInteractionRef } = useProject();
  const projectName = useSelector(projectRef, (state) => state.context.project?.name) ?? '';
  const producibilita = useProducibilita();
  const unitId = deriveModelInteractionUnitId({ sourceFile: mainEntryPath });
  const materialByComponentId = useSelector(
    modelInteractionRef,
    (state) => getModelInteractionUnitState(state.context, unitId).materialByComponentId,
  );
  const componentManifest = useSelector(modelInteractionRef, (state) => state.context.unitsById[unitId]?.manifest);
  const cadRef = geometryUnits.get(mainEntryPath);
  const parameterManifest = useSelector(cadRef, (state) => state?.context.parameterManifest);
  const parameterActor = useParameterSetActor(mainEntryPath);
  const parameterEntry = useSelector(parameterActor, (state) => state?.context.current?.entry);
  const { events } = useSinopiaSendEvents(projectId);

  const consegna = useMemo(() => creaConsegna(creaWorkerConsegna), []);
  useEffect(
    () => () => {
      consegna.chiudi();
    },
    [consegna],
  );

  const pezzi = useMemo(
    () =>
      pezziDellaConsegna({
        nodi: pieces,
        pezziProducibilita: producibilita?.pezzi,
        peso: (node) => pieceWeight(node, materialByComponentId[node.id])?.grams,
      }),
    [pieces, producibilita?.pezzi, materialByComponentId],
  );
  const partType = useMemo(() => {
    const famiglia = producibilita?.famiglia ? famiglie[producibilita.famiglia.id] : undefined;
    const [primo] = famiglia?.partTypes ?? [];
    return isTipoPezzo(primo) ? primo : undefined;
  }, [producibilita?.famiglia]);

  const controlli = producibilita?.controlli;
  const delivery = useMemo((): ProjectDelivery => {
    const numero = (valore: number, cifre = 2): string =>
      formatNumber(valore, language, { maximumFractionDigits: cifre });
    const defaults = (parameterManifest?.defaults ?? {}) as Record<string, unknown>;
    const values = getActiveGroupValues(parameterEntry) as Record<string, unknown>;
    const gruppi = groupPieceMeasures(componentManifest, defaults);
    const ultima = Math.max(0, ...events.map(({ versionNumber }) => versionNumber));
    const testi: TestiTavola = {
      titolo: t('consegna.sheet.title'),
      progetto: t('consegna.sheet.project'),
      pezzi: t('consegna.sheet.pieces'),
      versione: t('consegna.sheet.version'),
      data: t('consegna.sheet.date'),
      scala: t('consegna.sheet.scale'),
      unita: t('consegna.sheet.units'),
      proiezione: t('consegna.sheet.projection'),
      foglio: t('consegna.sheet.sheet'),
      fronte: t('consegna.sheet.front'),
      lato: t('consegna.sheet.left'),
      alto: t('consegna.sheet.top'),
      isometrica: t('consegna.sheet.iso'),
      nonInScala: t('consegna.sheet.notToScale'),
      colonnaPezzo: t('consegna.sheet.piece'),
      colonnaMateriale: t('consegna.sheet.material'),
      colonnaProcesso: t('consegna.sheet.process'),
      colonnaPeso: t('consegna.sheet.weight'),
      pesoTotale: t('consegna.sheet.totalWeight'),
      misure: t('consegna.sheet.measures'),
      producibilita: t('consegna.sheet.producibility'),
      nessunControllo: t('consegna.sheet.noChecks'),
      livelli: {
        blocco: t('consegna.sheet.levels.blocco'),
        avviso: t('consegna.sheet.levels.avviso'),
        ok: t('consegna.sheet.levels.ok'),
        info: t('consegna.sheet.levels.info'),
      },
      note: t('consegna.sheet.notes'),
      segue: t('consegna.sheet.continues'),
    };
    return {
      consegna,
      convertIges: convertIgesInBrowser,
      projectName: projectName || 'SinopiaCAD',
      pieces: pezziPerIlWorker(pezzi),
      glbMaterials: materialiGlb(pezzi),
      sheet: (drawings, selectedNames, versionLabel) => {
        const scelti = selectedNames ? pezzi.filter(({ nome }) => selectedNames.includes(nome)) : pezzi;
        return {
          progetto: projectName || 'SinopiaCAD',
          selezione: selectedNames?.join(', ') ?? t('consegna.sheet.allPieces'),
          versione: versionLabel ?? (ultima > 0 ? `v${String(ultima)}` : t('consegna.sheet.draft')),
          data: new Date(),
          lingua: language,
          viste: drawings.viste,
          ingombro: drawings.ingombro,
          pezzi: scelti.map((pezzo) => ({
            nome: pezzo.nome,
            ...(pezzo.materiale ? { materiale: pezzo.materiale.nome } : {}),
            ...(pezzo.processo ? { processo: t(`producibilita.processes.${pezzo.processo}`) } : {}),
            ...(pezzo.pesoGrammi === undefined ? {} : { pesoGrammi: pezzo.pesoGrammi }),
          })),
          misure: righeMisure({
            pezzi: drawings.pezzi,
            valoreChiave: (nome) => {
              const gruppo = gruppi.find((voce) => voce.node?.name === nome);
              return gruppo ? pieceKeyValue({ group: gruppo, defaults, values, language }) : '';
            },
            ingombroParola: t('consegna.sheet.overall'),
            numero,
          }),
          controlli: righeControlli({
            controlli: controlli ?? [],
            nome: (controllo) => nomeControllo(t, controllo.codice),
            valore: (controllo) => valoreControllo(controllo, t, language),
            ...(selectedNames ? { selezionati: selectedNames } : {}),
          }),
          testi,
        };
      },
    };
  }, [
    componentManifest,
    consegna,
    controlli,
    events,
    language,
    parameterEntry,
    parameterManifest,
    pezzi,
    projectName,
    t,
  ]);
  return { delivery, pezzi, partType };
}
