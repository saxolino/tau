import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import type { GeometryComponentManifest } from '@taucad/types';
import { manualEdgeGeometrySchema, manualFaceGeometrySchema } from '@taucad/smlib/manual-operations';
import type { ManualOperation } from '@taucad/smlib/manual-operations';
import type { PlanarFaceTool } from '@taucad/viewer/cad/planar-face-tool';
import type { SketchEdgePick, SketchTool } from '@taucad/viewer/cad/sketch-tool';
import { fromSketchPoint, sketchLoopPolygon, sketchLoops, sketchPolygonArea } from '@taucad/viewer/cad/sketch-geometry';
import type { SketchFrame, SketchSnap } from '@taucad/viewer/cad/sketch-geometry';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import type { ManualEdits } from '#hooks/use-manual-edits.js';
import { faceDirection } from '#lib/inspector-selection.js';
import { nextManualProfileName } from '#services/manual-profile-editor.js';
import {
  defaultSketchOperation,
  edgeAxisOnPlane,
  edgePathPoints,
  emptySketchDrawing,
  parseSketchQuota,
  reduceSketchDrawing,
  reopenSketchOperation,
  sketchAxisLines,
  sketchBasePlane,
  sketchCommit,
  sketchFacePlane,
  sketchLiveQuota,
  sketchOperationGhost,
  sketchPathPoints,
  sketchPathProfile,
  sketchPendingEntities,
} from '#services/manual-sketch.js';
import type {
  SketchDrawEvent,
  SketchDrawing,
  SketchCommitError,
  SketchOperationDraft,
  SketchPlane,
  SketchQuota,
  SketchToolKind,
} from '#services/manual-sketch.js';
import { useTranslation } from '#i18n/translate.js';

const vector = z.tuple([z.number(), z.number(), z.number()]);
const pieceDescriptor = z.object({
  manualTargetName: z.string().min(1),
  manualFaces: z
    .array(
      z.object({
        faceId: z.number().int().nonnegative(),
        center: vector,
        normal: vector,
        geometry: manualFaceGeometrySchema.optional(),
      }),
    )
    .optional(),
  manualEdges: z
    .array(z.object({ edgeId: z.number().int().nonnegative(), geometry: manualEdgeGeometrySchema }))
    .optional(),
  manualBounds: z.object({ min: vector, max: vector }).optional(),
});

/** Why the sketch cannot go on: shown in the inspector and the bar. */
export type ManualSketchProblem =
  | SketchCommitError
  | 'commit'
  | 'faceNotPlanar'
  | 'axisOffPlane'
  | 'pathInvalid'
  | 'notReopenable';

type Stage = 'plane' | 'draw' | 'pickEdge';
type Session = Readonly<{
  stage: Stage;
  plane?: SketchPlane;
  drawing: SketchDrawing;
  draft: SketchOperationDraft;
  target?: string;
  name: string;
  loopIndex: number;
  editingId?: string;
  pickFor?: 'axis' | 'path';
  /** The profile sketch, set aside while the sweep path is drawn in a second sketch. */
  main?: Readonly<{ plane: SketchPlane; drawing: SketchDrawing }>;
  typing: boolean;
  problem?: ManualSketchProblem;
  problemDetail?: string;
}>;

/** The sketch as the inspector and the viewer bar show and drive it. */
export type ManualSketchControls = Readonly<{
  available: boolean;
  active: boolean;
  stage?: Stage;
  /** Drawing the sweep path in a second sketch. */
  isPath: boolean;
  plane?: SketchPlane;
  drawing?: SketchDrawing;
  draft?: SketchOperationDraft;
  loops: ReadonlyArray<Readonly<{ area: number }>>;
  loopIndex: number;
  axisLineCount: number;
  pathSegmentCount?: number;
  target?: string;
  name: string;
  targets: readonly string[];
  liveQuota?: SketchQuota;
  typing: boolean;
  editing: boolean;
  problem?: ManualSketchProblem;
  problemDetail?: string;
  canApply: boolean;
  busy: boolean;
  /** Start on the selected face, or ask for a plane. */
  onStart: (face?: Readonly<{ componentId: string; faceId: number }>) => void;
  onBasePlane: (plane: 'xy' | 'xz' | 'yz') => void;
  /** Reopen an operation of the history as its sketch; false when it was not drawn as one. */
  onReopen: (operation: ManualOperation) => boolean;
  onTool: (tool: SketchToolKind) => void;
  onCornerRadius: (radius: number) => void;
  onQuotaOpen: () => void;
  onQuotaSubmit: (text: string) => void;
  onQuotaCancel: () => void;
  onDraft: (patch: Partial<SketchOperationDraft>) => void;
  onTarget: (name: string) => void;
  onName: (name: string) => void;
  onLoop: (index: number) => void;
  onAxisLine: () => void;
  onPickEdge: (purpose: 'axis' | 'path') => void;
  onDrawPath: () => void;
  onPathPlane: (plane: 'alongX' | 'alongY') => void;
  onPathDone: () => void;
  onApply: () => void;
  onExit: () => void;
}>;

/** The two planes a sweep path is drawn on: through the profile's center, standing on its normal. */
function pathPlane(
  main: SketchPlane,
  center: readonly [number, number, number],
  along: 'alongX' | 'alongY',
): SketchPlane {
  const { xDir, yDir, normal } = main.frame;
  const negate = (value: readonly [number, number, number]): [number, number, number] => [
    0 - value[0],
    0 - value[1],
    0 - value[2],
  ];
  const frame: SketchFrame =
    along === 'alongX'
      ? { origin: center, xDir, yDir: normal, normal: negate(yDir) }
      : { origin: center, xDir: yDir, yDir: normal, normal: xDir };
  return { frame, label: along, piece: main.piece, extent: main.extent, key: `path:${along}:${main.key}` };
}

/**
 * The sketch on the model (E4): choose a plane (a flat face or a base plane), draw with snaps and typed quotas, then
 * extrude, revolve or sweep the closed profile through the manual history. One operation per Applica, undoable as
 * any other; an operation drawn here reopens as its sketch. Nothing is written until Applica.
 */
export function useManualSketchTool({
  edits,
  manifest,
  ready,
  open,
  targets,
  selectedPiece,
}: Readonly<{
  edits: ManualEdits;
  manifest: GeometryComponentManifest | undefined;
  ready: boolean;
  open: boolean;
  targets: readonly string[];
  selectedPiece?: string;
}>): Readonly<{ tool?: SketchTool; planeTool?: PlanarFaceTool; controls: ManualSketchControls }> {
  const { t } = useTranslation();
  const [session, setSession] = useState<Session>();
  const [isCommitting, setIsCommitting] = useState(false);
  const available = ready && open && !edits.loading && !edits.error && manifest !== undefined && !manifest.mechanism;
  const active = session !== undefined && open;
  const busy = edits.saving || isCommitting;

  const pieces = useMemo(() => {
    const result = new Map<string, z.infer<typeof pieceDescriptor>>();
    for (const [id, node] of Object.entries(manifest?.nodesById ?? {})) {
      const parsed = pieceDescriptor.safeParse(node.extras);
      if (parsed.success) {
        result.set(id, parsed.data);
      }
    }
    return result;
  }, [manifest]);
  const modelExtent = useMemo(() => {
    let extent = 0;
    for (const piece of pieces.values()) {
      if (piece.manualBounds) {
        const { min, max } = piece.manualBounds;
        extent = Math.max(extent, ...[...min, ...max].map((value) => Math.abs(value)));
      }
    }
    return extent > 0 ? extent * 1.2 : 20;
  }, [pieces]);
  const newName = useCallback(
    () => nextManualProfileName({ document: edits.document, targets, defaultName: t('manualEdit.newName') }),
    [edits.document, targets, t],
  );

  const update = useCallback((change: (current: Session) => Session) => {
    setSession((current) => (current ? change(current) : current));
  }, []);
  const draw = useCallback(
    (event: SketchDrawEvent) => {
      update((current) => ({ ...current, drawing: reduceSketchDrawing(current.drawing, event), problem: undefined }));
    },
    [update],
  );

  const begin = useCallback(
    (plane: SketchPlane | undefined, mode: 'add' | 'cut' | 'new', target?: string) => {
      setSession({
        stage: plane ? 'draw' : 'plane',
        plane,
        drawing: emptySketchDrawing('line'),
        draft: defaultSketchOperation(mode),
        target,
        name: newName(),
        loopIndex: 0,
        typing: false,
      });
    },
    [newName],
  );
  const facePlane = useCallback(
    (componentId: string, faceId: number): SketchPlane | undefined => {
      const piece = pieces.get(componentId);
      const face = piece?.manualFaces?.find((candidate) => candidate.faceId === faceId);
      if (!piece || !face) {
        return undefined;
      }
      const normal = face.geometry?.normal ?? face.normal;
      const center = face.geometry?.center ?? face.center;
      return sketchFacePlane(
        { center, normal, bounds: face.geometry?.bounds },
        t(`inspector.faces.${faceDirection(normal)}`),
        piece.manualTargetName,
      );
    },
    [pieces, t],
  );

  const onStart = useCallback(
    (face?: Readonly<{ componentId: string; faceId: number }>) => {
      const plane = face ? facePlane(face.componentId, face.faceId) : undefined;
      if (plane) {
        begin(plane, 'add', plane.piece);
      } else {
        begin(undefined, targets.length > 0 ? 'add' : 'new', selectedPiece ?? targets[0]);
      }
    },
    [begin, facePlane, selectedPiece, targets],
  );
  const onBasePlane = useCallback(
    (name: 'xy' | 'xz' | 'yz') => {
      const plane = { ...sketchBasePlane(name, modelExtent), label: t(`sketch.planes.${name}`) };
      setSession((current) =>
        current
          ? {
              ...current,
              stage: 'draw',
              plane,
              draft: { ...current.draft, mode: current.draft.mode === 'cut' ? 'cut' : 'new' },
            }
          : {
              stage: 'draw',
              plane,
              drawing: emptySketchDrawing('line'),
              draft: defaultSketchOperation('new'),
              target: selectedPiece ?? targets[0],
              name: newName(),
              loopIndex: 0,
              typing: false,
            },
      );
    },
    [modelExtent, newName, selectedPiece, t, targets],
  );
  const onReopen = useCallback(
    (operation: ManualOperation): boolean => {
      const reopened = reopenSketchOperation(operation);
      if (!reopened) {
        return false;
      }
      setSession({
        stage: 'draw',
        plane: {
          frame: reopened.frame,
          label: t(`inspector.faces.${faceDirection(reopened.frame.normal)}`),
          piece: reopened.target,
          extent: modelExtent,
          key: `reopen:${operation.id}`,
        },
        drawing: emptySketchDrawing('line', reopened.entities),
        draft: reopened.draft,
        target: reopened.target ?? selectedPiece ?? targets[0],
        name: reopened.name ?? newName(),
        loopIndex: 0,
        editingId: operation.id,
        typing: false,
      });
      return true;
    },
    [modelExtent, newName, selectedPiece, t, targets],
  );

  // The plane is picked with the existing planar-face pick: a click inside a flat face of a piece.
  const stage = session?.stage;
  const planeTool = useMemo<PlanarFaceTool | undefined>(
    () =>
      active && stage === 'plane' && available
        ? {
            onPick: (pick) => {
              const plane = facePlane(pick.componentId, pick.faceId);
              update((current) =>
                plane
                  ? {
                      ...current,
                      stage: 'draw',
                      plane,
                      target: plane.piece ?? current.target,
                      draft: current.draft.mode === 'new' ? { ...current.draft, mode: 'add' } : current.draft,
                    }
                  : { ...current, problem: 'faceNotPlanar' },
              );
            },
            onPreview: () => undefined,
            onCommit: () => undefined,
            onCancel: () => undefined,
          }
        : undefined,
    [active, stage, available, facePlane, update],
  );

  // What the closed profile is, and the ghost of what it becomes.
  const entities = session?.drawing.entities;
  const mainEntities = session?.main?.drawing.entities;
  const loops = useMemo(() => (entities ? sketchLoops(entities) : []), [entities]);
  const profileLoops = useMemo(() => (mainEntities ? sketchLoops(mainEntities) : loops), [mainEntities, loops]);
  const loopIndex = Math.min(session?.loopIndex ?? 0, Math.max(profileLoops.length - 1, 0));
  const pathPoints = useMemo(() => {
    const path = session?.draft.path;
    if (!path) {
      return undefined;
    }
    return path.kind === 'sketch' ? sketchPathPoints(path.entities, path.frame) : edgePathPoints(path.geometry);
  }, [session?.draft.path]);
  const ghost = useMemo(
    () =>
      session && !session.main
        ? sketchOperationGhost({ loop: loops[loopIndex], draft: session.draft, pathPoints })
        : undefined,
    [session, loops, loopIndex, pathPoints],
  );

  const onPickEdgeRef = useRef<(pick: SketchEdgePick) => void>(() => undefined);
  useLayoutEffect(() => {
    onPickEdgeRef.current = (pick) => {
      const piece = pieces.get(pick.componentId);
      const edge = piece?.manualEdges?.find((candidate) => candidate.edgeId === pick.edgeId);
      update((current) => {
        if (!edge || !piece || !current.plane) {
          return { ...current, stage: 'draw', pickFor: undefined };
        }
        if (current.pickFor === 'axis') {
          const axis = edgeAxisOnPlane(edge.geometry, current.plane.frame);
          return axis
            ? {
                ...current,
                stage: 'draw',
                pickFor: undefined,
                draft: { ...current.draft, axis: { ...axis, source: 'edge' } },
              }
            : { ...current, stage: 'draw', pickFor: undefined, problem: 'axisOffPlane' };
        }
        return {
          ...current,
          stage: 'draw',
          pickFor: undefined,
          draft: {
            ...current.draft,
            path: { kind: 'edge', piece: piece.manualTargetName, geometry: edge.geometry },
          },
        };
      });
    };
  });

  const tool = useMemo<SketchTool | undefined>(() => {
    if (!active || !session.plane || session.stage === 'plane') {
      return undefined;
    }
    const { drawing, plane } = session;
    const regions = (session.main ? [] : loops).map((loop) => sketchLoopPolygon(loop));
    const curves = session.main
      ? sketchLoops(session.main.drawing.entities).map((loop) =>
          [...sketchLoopPolygon(loop), sketchLoopPolygon(loop)[0]!].map((point) =>
            fromSketchPoint(point, session.main!.plane.frame),
          ),
        )
      : pathPoints && session.draft.kind === 'sweep'
        ? [pathPoints]
        : [];
    return {
      frame: plane.frame,
      frameKey: plane.key,
      extent: plane.extent,
      entities: drawing.entities,
      pending: sketchPendingEntities(drawing),
      regions,
      axis: !session.main && session.draft.kind === 'revolve' ? session.draft.axis : undefined,
      curves,
      ghost,
      mode: session.stage === 'pickEdge' ? 'pickEdge' : 'draw',
      // Horizontal and vertical follow the previous point; a rectangle's opposite corner would collapse on them.
      reference: drawing.tool === 'rectangle' ? undefined : drawing.clicks.at(-1),
      onPointer: ({ type, snap }: { type: 'move' | 'click' | 'doubleClick'; snap: SketchSnap }) => {
        draw({ type, snap });
      },
      onPickEdge: (pick) => {
        onPickEdgeRef.current(pick);
      },
    };
  }, [active, session, loops, pathPoints, ghost, draw]);

  const onExit = useCallback(() => {
    setSession(undefined);
  }, []);
  const onApply = useCallback(() => {
    const current = session;
    if (!current?.plane || current.main !== undefined || !edits.document || busy) {
      return;
    }
    const result = sketchCommit({
      document: edits.document,
      frame: current.plane.frame,
      entities: current.drawing.entities,
      loopIndex,
      draft: current.draft,
      target: current.target,
      name: current.name,
      editingId: current.editingId,
    });
    if ('error' in result) {
      update((held) => ({ ...held, problem: result.error, problemDetail: result.detail }));
      return;
    }
    setIsCommitting(true);
    const commit = async (): Promise<void> => {
      try {
        const saved = await edits.commit(result.document);
        if (saved) {
          setSession(undefined);
        } else {
          update((held) => ({ ...held, problem: 'commit' }));
        }
      } finally {
        setIsCommitting(false);
      }
    };
    void commit();
  }, [session, edits, busy, loopIndex, update]);

  const onDrawPath = useCallback(() => {
    update((current) => {
      if (!current.plane || current.main) {
        return current;
      }
      const loop = loops[loopIndex];
      const polygon = loop ? sketchLoopPolygon(loop) : [];
      const centroid =
        polygon.length > 0
          ? {
              x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
              y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
            }
          : { x: 0, y: 0 };
      const existing = current.draft.path?.kind === 'sketch' ? current.draft.path : undefined;
      const plane = existing
        ? {
            frame: existing.frame,
            label: 'path',
            piece: current.plane.piece,
            extent: current.plane.extent,
            key: `path:edit:${current.plane.key}`,
          }
        : pathPlane(current.plane, fromSketchPoint(centroid, current.plane.frame), 'alongY');
      return {
        ...current,
        main: { plane: current.plane, drawing: current.drawing },
        plane,
        drawing: emptySketchDrawing('line', existing?.entities ?? []),
        draft: { ...current.draft, kind: 'sweep' },
        problem: undefined,
      };
    });
  }, [loops, loopIndex, update]);
  const onPathPlane = useCallback(
    (along: 'alongX' | 'alongY') => {
      update((current) => {
        if (!current.main || !current.plane) {
          return current;
        }
        return { ...current, plane: pathPlane(current.main.plane, current.plane.frame.origin, along) };
      });
    },
    [update],
  );
  const onPathDone = useCallback(() => {
    update((current) => {
      if (!current.main || !current.plane) {
        return current;
      }
      const profile = sketchPathProfile(current.drawing.entities, current.plane.frame);
      if (!profile) {
        return { ...current, problem: 'pathInvalid' };
      }
      return {
        ...current,
        plane: current.main.plane,
        drawing: current.main.drawing,
        main: undefined,
        draft: {
          ...current.draft,
          path: { kind: 'sketch', frame: current.plane.frame, entities: current.drawing.entities },
        },
        problem: undefined,
      };
    });
  }, [update]);
  const leavePath = useCallback(() => {
    update((current) =>
      current.main
        ? { ...current, plane: current.main.plane, drawing: current.main.drawing, main: undefined }
        : current,
    );
  }, [update]);

  const canApply =
    active &&
    available &&
    !busy &&
    session.stage === 'draw' &&
    !session.main &&
    loops.length > 0 &&
    (session.draft.mode === 'new' || Boolean(session.target)) &&
    (session.draft.kind !== 'revolve' || session.draft.axis !== undefined) &&
    (session.draft.kind !== 'sweep' || session.draft.path !== undefined);

  // The sketch's keys: L A C R S tools, D the quota, Enter, Esc, Backspace. Above the viewer's own (S is Section).
  const keys = useRef({ active, session, canApply, onApply, onExit, leavePath, draw });
  useLayoutEffect(() => {
    keys.current = { active, session, canApply, onApply, onExit, leavePath, draw };
  });
  const sketchKeys = useMemo(
    () =>
      ({
        ignoreInputs: true,
        scope: 'global',
        priority: 3,
        enabled: () => keys.current.active && keys.current.session?.stage !== 'plane' && !keys.current.session?.typing,
      }) as const,
    [],
  );
  const chooseTool = useCallback(
    (next: SketchToolKind) => {
      draw({ type: 'tool', tool: next });
    },
    [draw],
  );
  useKeybinding(
    { key: 'l' },
    () => {
      chooseTool('line');
    },
    sketchKeys,
  );
  useKeybinding(
    { key: 'a' },
    () => {
      const drawing = keys.current.session?.drawing;
      const chaining = drawing?.tool === 'line' && drawing.clicks.length === 1;
      chooseTool(chaining || drawing?.tool === 'arc' ? 'tangentArc' : 'arc');
    },
    sketchKeys,
  );
  useKeybinding(
    { key: 'c' },
    () => {
      chooseTool('circle');
    },
    sketchKeys,
  );
  useKeybinding(
    { key: 'r' },
    () => {
      chooseTool('rectangle');
    },
    sketchKeys,
  );
  useKeybinding(
    { key: 's' },
    () => {
      chooseTool('spline');
    },
    sketchKeys,
  );
  useKeybinding(
    { key: 'd' },
    () => {
      update((current) => ({ ...current, typing: true }));
    },
    sketchKeys,
  );
  useKeybinding(
    { key: 'Enter' },
    () => {
      const { current } = keys;
      if (current.session?.drawing.clicks.length) {
        current.draw({ type: 'finish' });
      } else if (current.canApply) {
        current.onApply();
      }
    },
    sketchKeys,
  );
  useKeybinding(
    { key: 'Backspace' },
    () => {
      keys.current.draw({ type: 'undo' });
    },
    sketchKeys,
  );
  useKeybinding(
    { key: 'Escape' },
    () => {
      const { current } = keys;
      const held = current.session;
      if (held?.stage === 'pickEdge') {
        update((state) => ({ ...state, stage: 'draw', pickFor: undefined }));
      } else if (held?.drawing.clicks.length) {
        current.draw({ type: 'cancel' });
      } else if (held?.main) {
        current.leavePath();
      } else {
        current.onExit();
      }
    },
    { ...sketchKeys, enabled: () => keys.current.active && !keys.current.session?.typing },
  );

  const controls = useMemo<ManualSketchControls>(() => {
    const pathEntities = session?.draft.path?.kind === 'sketch' ? session.draft.path.entities : undefined;
    return {
      available,
      active,
      stage: session?.stage,
      isPath: session?.main !== undefined,
      plane: session?.plane,
      drawing: session?.drawing,
      draft: session?.draft,
      loops: profileLoops.map((loop) => ({ area: Math.abs(sketchPolygonArea(sketchLoopPolygon(loop))) })),
      loopIndex,
      axisLineCount: session ? sketchAxisLines(session.drawing.entities).length : 0,
      pathSegmentCount: pathEntities?.length,
      target: session?.target,
      name: session?.name ?? '',
      targets,
      liveQuota: session ? sketchLiveQuota(session.drawing) : undefined,
      typing: session?.typing ?? false,
      editing: session?.editingId !== undefined,
      problem: session?.problem,
      problemDetail: session?.problemDetail,
      canApply,
      busy,
      onStart,
      onBasePlane,
      onReopen,
      onTool: chooseTool,
      onCornerRadius: (radius) => {
        draw({ type: 'cornerRadius', radius });
      },
      onQuotaOpen: () => {
        update((current) => ({ ...current, typing: true }));
      },
      onQuotaSubmit: (text) => {
        const values = parseSketchQuota(text);
        update((current) => ({
          ...current,
          typing: false,
          drawing: values
            ? reduceSketchDrawing(current.drawing, { type: 'quota', values })
            : { ...current.drawing, notice: 'quotaInvalid' },
        }));
      },
      onQuotaCancel: () => {
        update((current) => ({ ...current, typing: false }));
      },
      onDraft: (patch) => {
        update((current) => ({ ...current, draft: { ...current.draft, ...patch }, problem: undefined }));
      },
      onTarget: (name) => {
        update((current) => ({ ...current, target: name }));
      },
      onName: (name) => {
        update((current) => ({ ...current, name }));
      },
      onLoop: (index) => {
        update((current) => ({ ...current, loopIndex: index }));
      },
      onAxisLine: () => {
        update((current) => {
          const [line] = sketchAxisLines(current.drawing.entities);
          return line
            ? { ...current, draft: { ...current.draft, axis: { start: line.start, end: line.end, source: 'line' } } }
            : current;
        });
      },
      onPickEdge: (purpose) => {
        update((current) => ({ ...current, stage: 'pickEdge', pickFor: purpose, problem: undefined }));
      },
      onDrawPath,
      onPathPlane,
      onPathDone,
      onApply,
      onExit,
    };
  }, [
    available,
    active,
    session,
    profileLoops,
    loopIndex,
    targets,
    canApply,
    busy,
    onStart,
    onBasePlane,
    onReopen,
    chooseTool,
    draw,
    update,
    onDrawPath,
    onPathPlane,
    onPathDone,
    onApply,
    onExit,
  ]);

  return { tool, planeTool, controls };
}
