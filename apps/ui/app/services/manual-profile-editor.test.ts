import { describe, expect, it } from 'vitest';
import type { ManualDocument, ManualPointProfile } from '@taucad/smlib/manual-operations';
import {
  manualProfilePath,
  nextManualProfileName,
  resizeManualSegment,
  snapManualProfilePoint,
} from '#services/manual-profile-editor.js';

const profile: ManualPointProfile = {
  kind: 'polygon',
  plane: 'xy',
  origin: [0, 0, 0],
  points: [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 20, y: 0 },
    { id: 'c', x: 20, y: 20 },
    { id: 'd', x: 0, y: 20 },
  ],
};

describe('canonical profile editing', () => {
  it('should retain analytic signed circular arc commands and explicit open paths', () => {
    expect(
      manualProfilePath({
        kind: 'arc',
        plane: 'xy',
        origin: [0, 0, 0],
        center: { x: 0, y: 0 },
        radius: 10,
        startAngle: 0,
        sweepAngle: -270,
      }),
    ).toContain('A 10,10 0 1 1');
    expect(manualProfilePath({ ...profile, closed: false })).not.toContain(' Z');
    expect(manualProfilePath(profile)).toContain(' Z');
  });
  it('should edit the endpoint of a dimensioned segment and preserve other points', () => {
    const resized = resizeManualSegment(profile, 0, { length: 30 });
    expect(resized.points[1]).toEqual({ id: 'b', x: 30, y: 0 });
    expect(resized.points[0]).toEqual(profile.points[0]);
    expect(resized.points[2]).toEqual(profile.points[2]);
    expect(resizeManualSegment({ ...profile, closed: false }, 3, { length: 40 }).points).toEqual(profile.points);
  });
  it('should prioritize endpoints over grid and exclude the moving point and its adjacent midpoints', () => {
    expect(
      snapManualProfilePoint({ profile, point: { x: 19.7, y: 0.1 }, excludeId: 'a', tolerance: 0.5, grid: 3 }),
    ).toEqual({ point: { x: 20, y: 0 }, kind: 'endpoint' });
    expect(
      snapManualProfilePoint({ profile, point: { x: 10.1, y: 20.1 }, excludeId: 'a', tolerance: 0.5, grid: 3 }),
    ).toEqual({ point: { x: 10, y: 20 }, kind: 'midpoint' });
    expect(
      snapManualProfilePoint({ profile, point: { x: 0.2, y: 7 }, excludeId: 'a', tolerance: 0.5, grid: 3 }),
    ).toEqual({ point: { x: 0, y: 7 }, kind: 'axis' });
    expect(
      snapManualProfilePoint({ profile, point: { x: 7.1, y: 7.1 }, excludeId: 'a', tolerance: 0.5, grid: 3 }),
    ).toEqual({ point: { x: 6, y: 6 }, kind: 'grid' });
  });
  it('should not label a spline chord midpoint as a curve midpoint', () => {
    const spline: ManualPointProfile = { ...profile, kind: 'spline' };
    expect(
      snapManualProfilePoint({ profile: spline, point: { x: 10.1, y: 20.1 }, excludeId: 'a', tolerance: 0.5, grid: 3 })
        .kind,
    ).toBe('axis');
  });
  it('should reserve sketch and solid names for new profiles and conversions', () => {
    const document: ManualDocument = {
      version: 1,
      operations: [
        { id: 'wire', type: 'sketch', name: 'Profile', profile },
        { id: 'solid', type: 'extrude', mode: 'new', name: 'Profile 2', profile, distance: 10 },
        { id: 'cut', type: 'extrude', mode: 'cut', target: { name: 'Body' }, profile, distance: 2 },
      ],
    };
    expect(nextManualProfileName({ document, targets: ['Body'], defaultName: 'Profile', excludeId: 'cut' })).toBe(
      'Profile 3',
    );
    expect(nextManualProfileName({ document, targets: ['Body'], defaultName: 'Profile', excludeId: 'wire' })).toBe(
      'Profile',
    );
  });
});
