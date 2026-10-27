import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import type { Language } from '#i18n/language.js';
import { formatNumber } from '#i18n/translate.js';
import { pieceDimensions } from '#lib/inspector-selection.js';
import { groupPieceMeasures, pieceKeyValue, readablePieceName } from '#lib/piece-measures.js';

/** A piece's label as it enters: its name and its main measure, «Telaio · 38 × 32». */
export type PieceCaption = Readonly<{ name: string; measure: string | undefined }>;

/**
 * Name a piece and give its main measure: the measure the Measures pane shows for it when its parameters have one
 * (length × width, ⌀ diameter…), otherwise the two largest sides of its size. Millimetres, without the unit.
 *
 * @param input - The piece, the model's components, the parameter defaults and values, and the interface language.
 * @returns The caption.
 */
export function pieceCaption({
  node,
  manifest,
  defaults,
  values,
  language,
}: Readonly<{
  node: GeometryComponentNode;
  manifest: GeometryComponentManifest;
  defaults: Record<string, unknown>;
  values: Record<string, unknown>;
  language: Language;
}>): PieceCaption {
  const name = readablePieceName(node.name, language);
  const group = groupPieceMeasures(manifest, defaults).find((candidate) => candidate.node?.id === node.id);
  const fromParameters = group ? pieceKeyValue({ group, defaults, values, language }).replace(/\s*mm$/u, '') : '';
  if (fromParameters !== '') {
    return { name, measure: fromParameters };
  }
  const size = pieceDimensions(node);
  if (!size) {
    return { name, measure: undefined };
  }
  const [largest = 0, middle = 0] = [size.length, size.depth, size.height].toSorted((a, b) => b - a);
  const format = (value: number): string => formatNumber(value, language, { maximumFractionDigits: 1 });
  if (!(largest > 0)) {
    return { name, measure: undefined };
  }
  return { name, measure: middle > 0 ? `${format(largest)} × ${format(middle)}` : format(largest) };
}

/** A label to place: its piece's anchor on the canvas and its size, in CSS pixels. */
export type Callout = Readonly<{ id: string; x: number; y: number; width: number; height: number }>;

/** Where a label goes: its top-left corner on the canvas, in CSS pixels. */
export type PlacedCallout = Readonly<{ id: string; left: number; top: number }>;

/** Room kept free at the canvas's bottom, for the viewer's bar. CSS pixels. */
const bottomReserve = 56;
const margin = 8;
const gap = 4;
const offset = 10;

/**
 * Place the labels beside their pieces: each starts just right of its piece's centre, stays on the canvas and above
 * the viewer's bar, and moves down until it covers no label placed before it.
 *
 * @param callouts - The labels, in the order the pieces entered.
 * @param canvas - The canvas size, in CSS pixels.
 * @returns Each label's top-left corner, in the same order.
 */
export function placeCallouts(
  callouts: readonly Callout[],
  canvas: Readonly<{ width: number; height: number }>,
): PlacedCallout[] {
  const placed: Array<PlacedCallout & { width: number; height: number }> = [];
  for (const callout of callouts) {
    const left = Math.max(margin, Math.min(callout.x + offset, canvas.width - callout.width - margin));
    const lowest = Math.max(margin, canvas.height - bottomReserve - callout.height);
    let top = Math.max(margin, Math.min(callout.y - callout.height / 2, lowest));
    for (let moved = true; moved; ) {
      moved = false;
      for (const other of placed) {
        const overlaps =
          left < other.left + other.width + gap &&
          other.left < left + callout.width + gap &&
          top < other.top + other.height + gap &&
          other.top < top + callout.height + gap;
        if (overlaps) {
          top = other.top + other.height + gap;
          moved = true;
        }
      }
    }
    placed.push({ id: callout.id, left, top, width: callout.width, height: callout.height });
  }
  return placed.map(({ id, left, top }) => ({ id, left, top }));
}
