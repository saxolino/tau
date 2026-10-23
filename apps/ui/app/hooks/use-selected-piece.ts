import type { GeometryComponentNode, GeometryComponentManifest, GeometryComponentReference } from '@taucad/types';
import type { ActorRefFrom } from 'xstate';
import type { modelInteractionMachine } from '@taucad/viewer/machines/model-interaction.machine';
import { useSelector } from '@xstate/react';
import { useProject } from '#hooks/use-project.js';
import { buildGeometryComponentReference } from '@taucad/viewer/graphics/metadata/geometry-component-reference';
import { createSourceModelInteractionUnitId } from '@taucad/viewer/machines/model-interaction.machine';

/** Follow the shared selection; a viewer can restrict the chip to its own entry. */
export function useSelectedPiece(entryPath?: string):
  | Readonly<{
      unitId: string;
      node: GeometryComponentNode;
      manifest: GeometryComponentManifest;
      reference: GeometryComponentReference | undefined;
      actor: ActorRefFrom<typeof modelInteractionMachine> | undefined;
    }>
  | undefined {
  const project = useProject({ enableNoContext: true });
  const context = useSelector(project?.modelInteractionRef, (state) => state?.context);
  const preferred = entryPath ?? project?.mainEntryPath;
  const ids = entryPath ? [createSourceModelInteractionUnitId(entryPath)] : (context?.unitOrder ?? []);
  const ordered = preferred
    ? [...ids].sort(
        (a, b) =>
          Number(b === createSourceModelInteractionUnitId(preferred)) -
          Number(a === createSourceModelInteractionUnitId(preferred)),
      )
    : ids;
  for (const unitId of ordered) {
    const unit = context?.unitsById[unitId];
    const id = unit?.selectedComponentIds.at(-1);
    const manifest = unit?.manifest;
    const node = id ? manifest?.nodesById[id] : undefined;
    if (manifest && node) {
      return {
        unitId,
        node,
        manifest,
        reference: buildGeometryComponentReference(manifest, node),
        actor: project?.modelInteractionRef,
      };
    }
  }
  return undefined;
}
