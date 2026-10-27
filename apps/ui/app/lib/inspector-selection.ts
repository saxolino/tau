import { manualBoundsSchema, manualDocumentSchema } from '@taucad/smlib/manual-operations';
import type { ManualDocument, ManualOperation } from '@taucad/smlib/manual-operations';
import type { GeometryComponentNode } from '@taucad/types';
import type { Language } from '#i18n/language.js';
import { formatNumber } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import { isStonePiece, readablePieceName } from '#lib/piece-measures.js';

/** A piece's size along the model axes, in millimetres: length (X), depth (Y) and height (Z) of Tau's Z-up frame. */
export type PieceDimensions = Readonly<{ length: number; depth: number; height: number; exact: boolean }>;

const finitePositive = (value: number): boolean => Number.isFinite(value) && value >= 0;

/**
 * The size of a piece, read from the solid. SMLib bodies carry their exact native bounds (`manualBounds`, Z-up mm);
 * other kernels only give the glTF bounds (Y-up metres), which are converted and marked as not exact.
 *
 * @param node - The piece.
 * @returns Its size, or undefined when the piece carries no bounds.
 */
export function pieceDimensions(node: GeometryComponentNode | undefined): PieceDimensions | undefined {
  const exact = manualBoundsSchema.safeParse(node?.extras?.['manualBounds']);
  if (exact.success) {
    const { min, max } = exact.data;
    const size = { length: max[0] - min[0], depth: max[1] - min[1], height: max[2] - min[2], exact: true };
    return finitePositive(size.length) && finitePositive(size.depth) && finitePositive(size.height) ? size : undefined;
  }
  const bounds = node?.bounds;
  if (!bounds) {
    return undefined;
  }
  // The glTF frame is Y-up in metres: its Z is the model's depth and its Y the model's height.
  const size = {
    length: (bounds.max[0] - bounds.min[0]) * 1000,
    depth: (bounds.max[2] - bounds.min[2]) * 1000,
    height: (bounds.max[1] - bounds.min[1]) * 1000,
    exact: false,
  };
  return finitePositive(size.length) && finitePositive(size.depth) && finitePositive(size.height) ? size : undefined;
}

/**
 * How thick the piece is along a direction: its size projected on the (unit) normal. For a face of an axis-aligned
 * plate it is the plate's thickness; a through hole drilled from that face needs exactly this depth.
 *
 * @param node - The piece.
 * @param normal - A unit direction in model axes.
 * @returns Millimetres, or undefined without exact bounds.
 */
export function pieceExtentAlong(
  node: GeometryComponentNode | undefined,
  normal: readonly [number, number, number],
): number | undefined {
  const size = pieceDimensions(node);
  if (!size?.exact) {
    return undefined;
  }
  return Math.abs(normal[0]) * size.length + Math.abs(normal[1]) * size.depth + Math.abs(normal[2]) * size.height;
}

/** Where a face looks, in a designer's words; faces that look along no main axis are «inclined». */
export type FaceDirection = 'top' | 'bottom' | 'right' | 'left' | 'back' | 'front' | 'slanted';

/**
 * Name a planar face by its normal (Tau Z-up, front = −Y), never by its internal index.
 *
 * @param normal - The face's unit normal.
 * @returns The face's direction.
 */
export function faceDirection(normal: readonly [number, number, number]): FaceDirection {
  const [x, y, z] = normal;
  const threshold = 0.9;
  if (z >= threshold) {
    return 'top';
  }
  if (z <= -threshold) {
    return 'bottom';
  }
  if (x >= threshold) {
    return 'right';
  }
  if (x <= -threshold) {
    return 'left';
  }
  if (y >= threshold) {
    return 'back';
  }
  if (y <= -threshold) {
    return 'front';
  }
  return 'slanted';
}

/** What the inspector and the assistant are about: nothing (the model), a piece, a face of it or some of its edges. */
export type InspectorSelection =
  | Readonly<{ kind: 'model'; pieceCount: number }>
  | Readonly<{ kind: 'piece'; node: GeometryComponentNode }>
  | Readonly<{ kind: 'face'; node: GeometryComponentNode; direction: FaceDirection }>
  | Readonly<{ kind: 'edge'; node: GeometryComponentNode; edgeCount: number }>;

const roundTo = (value: number, step: number): number => Math.round(value / step) * step;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** The thinnest wall casting reliably fills, for metal accessories and jewellery (brass/zama and gold/silver alike). */
const castingMinimumMillimetres = 0.8;

/**
 * Two or three edits that fit the selection, with numbers read from its geometry: a fillet radius in proportion to the
 * piece, a thinning that keeps it castable, the casting minimum when the piece is below it. They fill the composer;
 * the person sends them, or changes them first.
 *
 * @param selection - What is selected.
 * @param t - The translator.
 * @param language - For the numbers.
 * @returns The suggestions, most useful first.
 */
export function contextualSuggestions(selection: InspectorSelection, t: Translate, language: Language): string[] {
  const mm = (value: number): string => formatNumber(value, language, { maximumFractionDigits: 1 });
  if (selection.kind === 'model') {
    return [t('inspector.chips.checkWalls'), t('inspector.chips.describe'), t('inspector.chips.lighter')];
  }
  const piece = readablePieceName(selection.node.name, language);
  const size = pieceDimensions(selection.node);
  const thinnest = size ? Math.min(size.length, size.depth, size.height) : undefined;
  const radius = thinnest === undefined ? 0.5 : clamp(roundTo(thinnest * 0.15, 0.1), 0.2, 1);
  if (selection.kind === 'edge') {
    return [
      t('inspector.chips.edgeFillet', { piece, radius: mm(radius) }),
      t('inspector.chips.edgeChamfer', { piece, amount: mm(clamp(roundTo(radius * 0.6, 0.1), 0.1, 0.6)) }),
      t('inspector.chips.edgeSimilar', { piece, radius: mm(radius) }),
    ];
  }
  if (selection.kind === 'face') {
    const face = t(`inspector.faces.${selection.direction}`);
    const diameter = thinnest === undefined ? 2 : clamp(roundTo(thinnest * 0.5, 0.5), 0.8, 4);
    return [
      t('inspector.chips.faceRaise', {
        piece,
        face,
        amount: mm(thinnest === undefined ? 1 : clamp(roundTo(thinnest * 0.25, 0.1), 0.2, 2)),
      }),
      t('inspector.chips.faceHole', { piece, face, diameter: mm(diameter) }),
      t('inspector.chips.faceChamfer', { piece, face, amount: mm(clamp(roundTo(radius * 0.6, 0.1), 0.1, 0.6)) }),
    ];
  }
  if (isStonePiece(selection.node)) {
    const widest = size ? Math.max(size.length, size.depth) : undefined;
    return [
      t('inspector.chips.prongs', { piece }),
      ...(widest === undefined ? [] : [t('inspector.chips.bigger', { piece, size: mm(roundTo(widest + 1, 0.5)) })]),
    ];
  }
  const suggestions = [t('inspector.chips.roundEdges', { piece, radius: mm(radius) })];
  if (thinnest !== undefined && thinnest < castingMinimumMillimetres) {
    suggestions.push(t('inspector.chips.castingMinimum', { piece, minimum: mm(castingMinimumMillimetres) }));
  } else if (thinnest !== undefined && thinnest - 1 >= castingMinimumMillimetres) {
    suggestions.push(t('inspector.chips.thinner', { piece, amount: mm(1) }));
  } else if (thinnest !== undefined) {
    suggestions.push(
      t('inspector.chips.thinner', { piece, amount: mm(roundTo(thinnest - castingMinimumMillimetres, 0.1)) }),
    );
  }
  if (size) {
    suggestions.push(t('inspector.chips.bigger', { piece, size: mm(roundTo(size.length * 1.1, 0.5)) }));
  }
  return suggestions.slice(0, 3);
}

const signed = (value: number, language: Language): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), language, { maximumFractionDigits: 2 })}`;

/**
 * One manual operation as a line a designer reads: what, how much, on which piece («Raccordo r 0,5 mm · 4 spigoli ·
 * Ardiglione»). Never an index or an identifier.
 *
 * @param operation - The operation.
 * @param t - The translator.
 * @param language - For names and numbers.
 * @returns The line.
 */
export function describeManualOperation(operation: ManualOperation, t: Translate, language: Language): string {
  const n = (value: number, digits = 2): string => formatNumber(value, language, { maximumFractionDigits: digits });
  const pieceOf = (name: string | undefined): string => readablePieceName(name ?? '', language);
  const sentence = ((): string => {
    switch (operation.type) {
      case 'translate': {
        return t('manualEdit.describe.translate', {
          piece: pieceOf(operation.target.name),
          x: n(operation.delta[0]),
          y: n(operation.delta[1]),
          z: n(operation.delta[2]),
        });
      }
      case 'rotate': {
        return t('manualEdit.describe.rotate', { piece: pieceOf(operation.target.name), angle: n(operation.angle, 1) });
      }
      case 'scale': {
        return t('manualEdit.describe.scale', {
          piece: pieceOf(operation.target.name),
          factor: n(operation.factor, 3),
        });
      }
      case 'mirror': {
        return t('manualEdit.describe.mirror', {
          piece: pieceOf(operation.target.name),
          plane: operation.plane.toUpperCase(),
        });
      }
      case 'hole': {
        return t('manualEdit.describe.hole', {
          piece: pieceOf(operation.target.name),
          diameter: n(operation.diameter),
          depth: n(operation.depth, 1),
        });
      }
      case 'fillet':
      case 'chamfer': {
        const { edges } = operation;
        const count = edges.kind === 'indices' ? edges.indices.length : 0;
        const edgeText =
          edges.kind === 'all'
            ? t('manualEdit.describe.edgesAll')
            : edges.kind === 'parallel'
              ? t('manualEdit.describe.edgesParallel')
              : t(count === 1 ? 'manualEdit.describe.edgesPickedOne' : 'manualEdit.describe.edgesPicked', { count });
        return t(operation.type === 'fillet' ? 'manualEdit.describe.fillet' : 'manualEdit.describe.chamfer', {
          piece: pieceOf(operation.target.name),
          size: n(operation.size),
          edges: edgeText,
        });
      }
      case 'faceExtrude': {
        return t('manualEdit.describe.faceExtrude', {
          piece: pieceOf(operation.target.name),
          distance: `${signed(operation.distance, language)} mm`,
        });
      }
      case 'extrude': {
        const extrusion =
          operation.mode === 'new'
            ? t('manualEdit.describe.extrudeNew', {
                name: pieceOf(operation.name),
                distance: n(operation.distance),
              })
            : t(operation.mode === 'add' ? 'manualEdit.describe.extrudeAdd' : 'manualEdit.describe.extrudeCut', {
                piece: pieceOf(operation.target?.name),
                // A cut goes into the piece: its depth reads as a positive length.
                distance: n(operation.mode === 'cut' ? Math.abs(operation.distance) : operation.distance),
              });
        return operation.taper === undefined
          ? extrusion
          : t('manualEdit.describe.extrudeTaper', { operation: extrusion, taper: n(operation.taper, 1) });
      }
      case 'revolve': {
        const angle = n(operation.angle, 1);
        if (operation.mode === 'new') {
          return t('manualEdit.describe.revolveNew', { name: pieceOf(operation.name), angle });
        }
        return t(operation.mode === 'add' ? 'manualEdit.describe.revolveAdd' : 'manualEdit.describe.revolveCut', {
          piece: pieceOf(operation.target?.name),
          angle,
        });
      }
      case 'sweep': {
        const path =
          operation.path.kind === 'edge'
            ? t('manualEdit.describe.pathEdge', { piece: pieceOf(operation.path.piece.name) })
            : t('manualEdit.describe.pathSketch');
        if (operation.mode === 'new') {
          return t('manualEdit.describe.sweepNew', { name: pieceOf(operation.name), path });
        }
        return t(operation.mode === 'add' ? 'manualEdit.describe.sweepAdd' : 'manualEdit.describe.sweepCut', {
          piece: pieceOf(operation.target?.name),
          path,
        });
      }
      case 'sketch': {
        return t('manualEdit.describe.sketch', { name: pieceOf(operation.name) });
      }
    }
  })();
  return operation.enabled === false ? t('manualEdit.describe.disabled', { operation: sentence }) : sentence;
}

const parseManual = (text: string): ManualDocument | undefined => {
  if (text.trim() === '') {
    return { version: 1, operations: [] };
  }
  try {
    const parsed = manualDocumentSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

/**
 * What changed between two manual histories, as the designer's sentences: added operations, removed ones, operations
 * switched off or on, and edited ones with their earlier values. Unreadable histories give nothing (the version keeps
 * its generic summary).
 *
 * @param input - The sidecar text before and after, and the language.
 * @returns One sentence per change, in history order.
 */
export function manualHistoryChanges({
  original,
  modified,
  t,
  language,
}: Readonly<{ original: string; modified: string; t: Translate; language: Language }>): string[] {
  const before = parseManual(original);
  const after = parseManual(modified);
  if (!before || !after) {
    return [];
  }
  const earlier = new Map(before.operations.map((operation) => [operation.id, operation]));
  const changes: string[] = [];
  for (const operation of after.operations) {
    const previous = earlier.get(operation.id);
    earlier.delete(operation.id);
    if (!previous) {
      changes.push(describeManualOperation(operation, t, language));
      continue;
    }
    if (JSON.stringify(previous) === JSON.stringify(operation)) {
      continue;
    }
    if ((previous.enabled === false) !== (operation.enabled === false)) {
      const line = describeManualOperation({ ...operation, enabled: true }, t, language);
      changes.push(
        t(operation.enabled === false ? 'manualEdit.describe.disabledNow' : 'manualEdit.describe.enabledAgain', {
          operation: line,
        }),
      );
      continue;
    }
    changes.push(
      t('manualEdit.describe.changed', {
        operation: describeManualOperation(operation, t, language),
        before: describeManualOperation(previous, t, language),
      }),
    );
  }
  for (const removed of earlier.values()) {
    changes.push(t('manualEdit.describe.removed', { operation: describeManualOperation(removed, t, language) }));
  }
  return changes;
}
