import { isManualProfileClosed, manualProfileSegments } from '@taucad/smlib/manual-operations';
import { sketchEntitySamples } from '@taucad/viewer/cad/sketch-geometry';
import type {
  ManualDocument,
  ManualPointProfile,
  ManualProfile,
  ManualProfilePoint,
} from '@taucad/smlib/manual-operations';

const polar = (center: ManualProfilePoint, radius: number, angle: number): ManualProfilePoint => ({
  x: center.x + radius * Math.cos((angle * Math.PI) / 180),
  y: center.y + radius * Math.sin((angle * Math.PI) / 180),
});
const svgPoint = (point: ManualProfilePoint): string => `${point.x},${-point.y}`;

/** Exact circular arcs and the kernel's canonical cubic controls share local millimetres. */
export function manualProfilePath(profile: ManualProfile): string {
  if (profile.kind === 'circle') {
    const { center, radius } = profile;
    return `M ${center.x + radius},${-center.y} A ${radius},${radius} 0 1 0 ${center.x - radius},${-center.y} A ${radius},${radius} 0 1 0 ${center.x + radius},${-center.y} Z`;
  }
  if (profile.kind === 'arc') {
    const start = polar(profile.center, profile.radius, profile.startAngle);
    const end = polar(profile.center, profile.radius, profile.startAngle + profile.sweepAngle);
    return `M ${svgPoint(start)} A ${profile.radius},${profile.radius} 0 ${Math.abs(profile.sweepAngle) > 180 ? 1 : 0} ${profile.sweepAngle > 0 ? 0 : 1} ${svgPoint(end)}`;
  }
  if (profile.kind === 'path') {
    // A sketched outline: lines as they are, arcs and splines through their samples.
    let from = profile.start;
    const segments = profile.segments.map((segment) => {
      const start = from;
      from = segment.to;
      const samples =
        segment.kind === 'line'
          ? [segment.to]
          : sketchEntitySamples(
              segment.kind === 'arc'
                ? { kind: 'arc', id: '', start, through: segment.through, end: segment.to }
                : { kind: 'spline', id: '', points: [start, ...segment.through, segment.to] },
            ).slice(1);
      return samples.map((point) => `L ${svgPoint(point)}`).join(' ');
    });
    return `M ${svgPoint(profile.start)} ${segments.join(' ')}${profile.closed ? ' Z' : ''}`;
  }
  const first = profile.points[0];
  if (!first) {
    return '';
  }
  const segments =
    profile.kind === 'polygon'
      ? profile.points.slice(1).map((point) => `L ${svgPoint(point)}`)
      : manualProfileSegments(profile).map(
          ({ control1, control2, end }) => `C ${svgPoint(control1)} ${svgPoint(control2)} ${svgPoint(end)}`,
        );
  return `M ${svgPoint(first)} ${segments.join(' ')}${isManualProfileClosed(profile) ? ' Z' : ''}`;
}

/** Bounds include cubic controls and the full analytic circle, so every visible curve fits. */
export function manualProfileBounds(profile: ManualProfile): { x: number; y: number; span: number } {
  const points =
    profile.kind === 'circle' || profile.kind === 'arc'
      ? [
          { x: profile.center.x - profile.radius, y: profile.center.y - profile.radius },
          { x: profile.center.x + profile.radius, y: profile.center.y + profile.radius },
        ]
      : profile.kind === 'path'
        ? [
            profile.start,
            ...profile.segments.flatMap((segment) => [
              ...(segment.kind === 'line' ? [] : segment.kind === 'arc' ? [segment.through] : segment.through),
              segment.to,
            ]),
          ]
        : [
            ...profile.points,
            ...(profile.kind === 'spline'
              ? manualProfileSegments(profile).flatMap(({ control1, control2 }) => [control1, control2])
              : []),
          ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => -point.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 20) * 1.4;
  return { x: (Math.max(...xs) + Math.min(...xs) - span) / 2, y: (Math.max(...ys) + Math.min(...ys) - span) / 2, span };
}

/** A dimension edits the next segment's end, retaining its direction and stable point identity. */
export function resizeManualSegment(
  profile: ManualPointProfile,
  index: number,
  dimension: { length: number; angle?: number },
): ManualPointProfile {
  const start = profile.points[index];
  const nextIndex = (index + 1) % profile.points.length;
  const end = profile.points[nextIndex];
  if (!start || !end || (!isManualProfileClosed(profile) && nextIndex === 0) || dimension.length <= 0) {
    return profile;
  }
  const angle = dimension.angle ?? (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  const changed = polar(start, dimension.length, angle);
  return {
    ...profile,
    points: profile.points.map((point, pointIndex) => (pointIndex === nextIndex ? { ...point, ...changed } : point)),
  };
}

export type ManualProfileSnap = { point: ManualProfilePoint; kind?: 'endpoint' | 'midpoint' | 'axis' | 'grid' };

/** Screen-space priority is endpoints, nonadjacent midpoints, axis alignment, then grid. */
export function snapManualProfilePoint(options: {
  profile: ManualPointProfile;
  point: ManualProfilePoint;
  excludeId?: string;
  tolerance: number;
  grid: number;
}): ManualProfileSnap {
  const { profile, point, excludeId, tolerance, grid } = options;
  const otherPoints = profile.points.filter((candidate) => candidate.id !== excludeId);
  const nearest = (candidates: ManualProfilePoint[]): ManualProfilePoint | undefined =>
    candidates
      .map((candidate) => ({ candidate, distance: Math.hypot(candidate.x - point.x, candidate.y - point.y) }))
      .filter(({ distance }) => distance <= tolerance)
      .sort((a, b) => a.distance - b.distance)[0]?.candidate;
  const endpoint = nearest(otherPoints);
  if (endpoint) {
    return { point: { x: endpoint.x, y: endpoint.y }, kind: 'endpoint' };
  }
  const midpoints = profile.points.flatMap((start, index) => {
    const end = profile.points[(index + 1) % profile.points.length];
    if (
      !end ||
      (!isManualProfileClosed(profile) && index === profile.points.length - 1) ||
      start.id === excludeId ||
      end.id === excludeId
    ) {
      return [];
    }
    return [{ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }];
  });
  const midpoint = profile.kind === 'polygon' ? nearest(midpoints) : undefined;
  if (midpoint) {
    return { point: midpoint, kind: 'midpoint' };
  }
  const alignedX = otherPoints.find((candidate) => Math.abs(candidate.x - point.x) <= tolerance);
  const alignedY = otherPoints.find((candidate) => Math.abs(candidate.y - point.y) <= tolerance);
  if (alignedX !== undefined || alignedY !== undefined) {
    return { point: { x: alignedX?.x ?? point.x, y: alignedY?.y ?? point.y }, kind: 'axis' };
  }
  return { point: { x: Math.round(point.x / grid) * grid, y: Math.round(point.y / grid) * grid }, kind: 'grid' };
}

/** Profile wires and solids share the native kernel's unique authored-name namespace. */
export function nextManualProfileName(options: {
  document: ManualDocument | undefined;
  targets: readonly string[];
  defaultName: string;
  excludeId?: string;
}): string {
  const names = new Set([
    ...options.targets,
    ...(options.document?.operations.flatMap((operation) =>
      operation.id !== options.excludeId &&
      (operation.type === 'sketch' ||
        operation.type === 'extrude' ||
        operation.type === 'revolve' ||
        operation.type === 'sweep') &&
      operation.name
        ? [operation.name]
        : [],
    ) ?? []),
  ]);
  let count = 1;
  let name = options.defaultName;
  while (names.has(name)) {
    name = `${options.defaultName} ${++count}`;
  }
  return name;
}
