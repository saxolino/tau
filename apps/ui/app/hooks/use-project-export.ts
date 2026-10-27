import { useCallback, useMemo } from 'react';
import type { GeometryComponentNode } from '@taucad/types';
import { useSelector } from '@xstate/react';
import { asKnownArtifact } from '@taucad/runtime';
import { randomUuid } from '@taucad/utils/id';
import { buildGltfComponentManifest } from '@taucad/viewer/graphics/metadata/gltf-component-manifest';
import { getGraphicsCameraState } from '@taucad/viewer/services/graphics-camera-registry';
import { useProject, useMainGraphics } from '#hooks/use-project.js';
import { useHeadlessImageService } from '#providers/headless-image-provider.js';
import { awaitFreshRender } from '#machines/await-fresh-render.js';
import { captureCadImages } from '#services/headless-capture.js';
import { exportPieces } from '#services/project-export-mesh.js';
import {
  captureProjectPhoto,
  prepareProjectExport,
  prepareSinopiaFiles,
  projectExportSketches,
} from '#services/project-export.js';
import type { ProjectExportSource } from '#services/project-export.js';
import type { PreparedExport, ProjectExportFormat, ProjectExportSketches } from '#services/project-export.types.js';
import { verifyStepInBrowser } from '#workers/project-export.client.js';
import { useProjectDelivery } from '#hooks/use-project-delivery.js';
import type { PezzoDellaConsegna } from '#lib/consegna.js';
import type { TipoPezzo } from '#services/sinopia-consegna.js';

/** Bind the reusable file preparation to the current project and its render owner. */
export function useProjectExport(): {
  pieces: GeometryComponentNode[];
  sketches: ProjectExportSketches | undefined;
  prepare: (
    format: ProjectExportFormat,
    selectedNames: string[] | undefined,
    signal: AbortSignal,
  ) => Promise<PreparedExport>;
  capturePhoto: (signal: AbortSignal) => Promise<PreparedExport>;
  prepareSinopia: (
    signal: AbortSignal,
    versionLabel?: string,
  ) => Promise<Awaited<ReturnType<typeof prepareSinopiaFiles>>>;
  /** Material, process and weight of each piece (E3a). */
  deliveryPieces: readonly PezzoDellaConsegna[];
  /** The part type the model's family declares, for «Chiedi preventivo». */
  partType: TipoPezzo | undefined;
  /** Whether the model is an SMLib one, whose IGES, DXF and PDF sheet the delivery writes. */
  deliveryAvailable: boolean;
} {
  const { projectRef, geometryUnits, mainEntryPath, entriesRecord } = useProject();
  const cadRef = geometryUnits.get(mainEntryPath);
  const rendering = useSelector(cadRef, (state) => state?.context.rendering);
  const evaluation = useSelector(cadRef, (state) => state?.context.evaluation);
  const kernelId = useSelector(cadRef, (state) => state?.context.activeKernelId);
  const outcome = useSelector(cadRef, (state) => state?.context.latestRenderingOutcome);
  const graphicsRef = useMainGraphics();
  const imageService = useHeadlessImageService();
  const pieces = useMemo(() => {
    if (!rendering?.success || rendering.transient || outcome !== 'success') {
      return [];
    }
    const artifact = asKnownArtifact(rendering.artifact);
    if (artifact?.mimeType !== 'model/gltf-binary') {
      return [];
    }
    try {
      return exportPieces(buildGltfComponentManifest(artifact.content));
    } catch {
      return [];
    }
  }, [rendering, outcome]);

  const { delivery, pezzi: deliveryPieces, partType } = useProjectDelivery(pieces);

  const sketches = useMemo(
    () => (outcome === 'success' ? projectExportSketches({ kernelId, evaluation, rendering }) : undefined),
    [outcome, kernelId, evaluation, rendering],
  );

  const withSource = useCallback(
    async <T>(
      signal: AbortSignal,
      run: (source: ProjectExportSource) => Promise<T>,
      unavailable: (problem: 'prepare' | 'changed') => T,
    ): Promise<T> => {
      if (!cadRef) {
        return unavailable('prepare');
      }
      const claimId = randomUuid();
      projectRef.send({
        type: 'claimGeometryUnit',
        claimId,
        entryPath: mainEntryPath,
        operationTimeout: entriesRecord?.entries[mainEntryPath]?.renderTimeout,
      });
      try {
        const settled = await awaitFreshRender(cadRef, { signal });
        const {
          document,
          kernelClient,
          activeKernelId,
          evaluation: freshEvaluation,
          rendering: fresh,
          latestRenderingOutcome,
        } = settled.context;
        if (
          !document ||
          !kernelClient ||
          !activeKernelId ||
          !fresh?.success ||
          fresh.transient ||
          latestRenderingOutcome !== 'success' ||
          fresh !== rendering ||
          freshEvaluation !== evaluation
        ) {
          return unavailable('changed');
        }
        return await run({
          document,
          client: kernelClient,
          kernelId: activeKernelId,
          rendering: fresh,
          pieces,
          sketches: projectExportSketches({ kernelId: activeKernelId, evaluation: freshEvaluation, rendering: fresh }),
          isCurrent: () => {
            const current = cadRef.getSnapshot().context;
            return (
              current.document === document &&
              current.evaluation === freshEvaluation &&
              current.rendering === fresh &&
              current.latestRenderingOutcome === 'success'
            );
          },
          // A drawing needs no camera; a model needs the viewer's current one.
          canCapture: () =>
            asKnownArtifact(fresh.artifact)?.mimeType === 'image/svg+xml' ||
            getGraphicsCameraState(graphicsRef) !== undefined,
          capture: async (captureSignal) => {
            const capture = await captureCadImages({
              cadRef,
              graphicsRef,
              imageService,
              cameraState: getGraphicsCameraState(graphicsRef),
              recipe: { purpose: 'utility', mode: 'current' },
              // The render settled above and is checked as current after the capture.
              captureRendering: async () => fresh,
              signal: captureSignal,
            });
            // Do not describe a capture with omitted sections as the current view.
            if (capture.omittedSectionCutIds.length > 0) {
              throw new Error('CAPTURE_OMITTED_SECTIONS');
            }
            return capture.files;
          },
          verifyStep: verifyStepInBrowser,
          delivery,
        });
      } catch {
        return unavailable('prepare');
      } finally {
        projectRef.send({ type: 'releaseGeometryUnit', claimId });
      }
    },
    [
      cadRef,
      delivery,
      entriesRecord,
      evaluation,
      graphicsRef,
      imageService,
      mainEntryPath,
      pieces,
      projectRef,
      rendering,
    ],
  );
  const prepare = useCallback(
    async (format: ProjectExportFormat, selectedNames: string[] | undefined, signal: AbortSignal) =>
      withSource<PreparedExport>(
        signal,
        async (source) => prepareProjectExport({ source, format, selectedNames, signal }),
        (problem) => ({ status: 'needsFix', problem }),
      ),
    [withSource],
  );
  const capturePhoto = useCallback(
    async (signal: AbortSignal) =>
      withSource<PreparedExport>(
        signal,
        async (source) => captureProjectPhoto({ source, signal }),
        (problem) => ({ status: 'needsFix', problem }),
      ),
    [withSource],
  );
  const prepareSinopia = useCallback(
    async (signal: AbortSignal, versionLabel?: string) => {
      return withSource(
        signal,
        async (source) =>
          prepareSinopiaFiles({ source, signal, ...(versionLabel === undefined ? {} : { versionLabel }) }),
        (problem) => {
          const unavailable: PreparedExport = { status: 'needsFix', problem };
          return { step: unavailable, glb: unavailable, photo: unavailable, pdf: unavailable };
        },
      );
    },
    [withSource],
  );
  return {
    pieces,
    sketches,
    prepare,
    capturePhoto,
    prepareSinopia,
    deliveryPieces,
    partType,
    deliveryAvailable: kernelId === 'smlib',
  };
}
