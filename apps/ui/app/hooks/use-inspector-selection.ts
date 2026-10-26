import { useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { useProject } from '#hooks/use-project.js';
import { useSelectedPiece } from '#hooks/use-selected-piece.js';
import { modelPieces } from '#lib/piece-measures.js';
import type { InspectorSelection } from '#lib/inspector-selection.js';
import { useProjectWorkspace } from '#routes/w.$workspace.$project/project-workspace-context.js';

/**
 * What the inspector and the assistant speak about: the shared model selection, narrowed to the face or the edges the
 * inspector's tools picked on that piece, or the whole model when nothing is selected.
 *
 * @returns The selection, with the selected piece when there is one.
 */
export function useInspectorSelection(): Readonly<{
  selection: InspectorSelection;
  piece: ReturnType<typeof useSelectedPiece>;
}> {
  const project = useProject({ enableNoContext: true });
  const piece = useSelectedPiece();
  const workspace = useProjectWorkspace({ enableNoContext: true });
  const sub = workspace?.inspectorSubSelection;
  const pieceCount = useSelector(project?.modelInteractionRef, (state) =>
    (state?.context.unitOrder ?? []).reduce(
      (count, id) => count + modelPieces(state?.context.unitsById[id]?.manifest).length,
      0,
    ),
  );
  const node = piece?.node;
  const selection = useMemo<InspectorSelection>(() => {
    if (!node) {
      return { kind: 'model', pieceCount };
    }
    if (sub?.componentId === node.id) {
      return sub.kind === 'face'
        ? { kind: 'face', node, direction: sub.direction }
        : { kind: 'edge', node, edgeCount: sub.edgeCount };
    }
    return { kind: 'piece', node };
  }, [node, sub, pieceCount]);
  return { selection, piece };
}
