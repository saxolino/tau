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
import { prepareProjectExport, prepareSinopiaFiles } from '#services/project-export.js';
import type { ProjectExportSource } from '#services/project-export.js';
import type { PreparedExport, ProjectExportFormat } from '#services/project-export.types.js';
import { verifyStepInBrowser } from '#workers/project-export.client.js';

/** Bind the reusable file preparation to the current project and its render owner. */
export function useProjectExport(): {
  pieces: GeometryComponentNode[];
  prepare: (
    format: ProjectExportFormat,
    selectedNames: string[] | undefined,
    signal: AbortSignal,
  ) => Promise<PreparedExport>;
  prepareSinopia: (signal: AbortSignal) => Promise<Awaited<ReturnType<typeof prepareSinopiaFiles>>>;
} {
  const { projectRef, geometryUnits, mainEntryPath, entriesRecord } = useProject();
  const cadRef = geometryUnits.get(mainEntryPath);
  const rendering = useSelector(cadRef, (state) => state?.context.rendering);
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
        const { document, kernelClient, activeKernelId, rendering: fresh, latestRenderingOutcome } = settled.context;
        if (
          !document ||
          !kernelClient ||
          !activeKernelId ||
          !fresh?.success ||
          fresh.transient ||
          latestRenderingOutcome !== 'success' ||
          fresh !== rendering
        ) {
          return unavailable('changed');
        }
        return await run({
          document,
          client: kernelClient,
          kernelId: activeKernelId,
          rendering: fresh,
          pieces,
          isCurrent: () => {
            const current = cadRef.getSnapshot().context;
            return (
              current.document === document &&
              current.rendering === fresh &&
              current.latestRenderingOutcome === 'success'
            );
          },
          capture: async () => {
            const capture = await captureCadImages({
              cadRef,
              graphicsRef,
              imageService,
              cameraState: getGraphicsCameraState(graphicsRef),
              recipe: { purpose: 'utility', mode: 'current' },
            });
            // Do not describe a capture with omitted sections as the current view.
            if (capture.omittedSectionCutIds.length > 0) {
              throw new Error('CAPTURE_OMITTED_SECTIONS');
            }
            return capture.files;
          },
          verifyStep: verifyStepInBrowser,
        });
      } catch {
        return unavailable('prepare');
      } finally {
        projectRef.send({ type: 'releaseGeometryUnit', claimId });
      }
    },
    [cadRef, entriesRecord, graphicsRef, imageService, mainEntryPath, pieces, projectRef, rendering],
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
  const prepareSinopia = useCallback(
    async (signal: AbortSignal) => {
      return withSource(
        signal,
        async (source) => prepareSinopiaFiles({ source, signal }),
        (problem) => {
          const unavailable: PreparedExport = { status: 'needsFix', problem };
          return { step: unavailable, glb: unavailable, photo: unavailable };
        },
      );
    },
    [withSource],
  );
  return { pieces, prepare, prepareSinopia };
}
