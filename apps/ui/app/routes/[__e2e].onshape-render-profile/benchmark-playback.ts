import type { KinematicsRef } from '@taucad/viewer/machines/graphics.machine';
import { getKinematicsAnimation } from '@taucad/viewer/machines/kinematics.machine';

export type PlaybackMeasurement = {
  unitId: string;
  animation: { id: string; duration: number; loop: string };
  speed: number;
  start: { time: number; revision: number };
  previousTime: number;
  playingSampleFrames: number;
  advancingSampleFrames: number;
};

/** Reset all mechanism units; only playable units enter the motion workload. */
export function prepareBenchmarkPlayback(actor: KinematicsRef, play: boolean): PlaybackMeasurement[] {
  const measurements: PlaybackMeasurement[] = [];
  for (const [unitId, unit] of Object.entries(actor.getSnapshot().context.unitsById)) {
    if (!unit.mechanism) {
      continue;
    }
    actor.send({ type: 'pause', unitId });
    actor.send({ type: 'seek', unitId, time: 0 });
    const animation = getKinematicsAnimation({
      mechanism: unit.mechanism,
      degreesOfFreedom: unit.degreesOfFreedom,
      animationId: unit.playback.animationId,
    });
    if (!play || !animation) {
      continue;
    }
    actor.send({ type: 'play', unitId });
    const started = actor.getSnapshot().context.unitsById[unitId]!;
    if (started.playback.status === 'playing') {
      measurements.push({
        unitId,
        animation: { id: animation.id, duration: animation.duration, loop: animation.loop ?? 'none' },
        speed: started.playback.speed,
        start: { time: started.playback.time, revision: started.revision },
        previousTime: started.playback.time,
        playingSampleFrames: 0,
        advancingSampleFrames: 0,
      });
    }
  }
  return measurements;
}

/** Count actual actor motion after each sampled render, independently of camera motion. */
export function sampleBenchmarkPlayback(actor: KinematicsRef, measurements: PlaybackMeasurement[]): void {
  for (const measurement of measurements) {
    const unit = actor.getSnapshot().context.unitsById[measurement.unitId];
    if (!unit) {
      continue;
    }
    measurement.playingSampleFrames += Number(unit.playback.status === 'playing');
    measurement.advancingSampleFrames += Number(unit.playback.time !== measurement.previousTime);
    measurement.previousTime = unit.playback.time;
  }
}

/** Preserve stopped/non-advancing clips as failed workloads, rather than calling them animation FPS. */
export function finishBenchmarkPlayback(
  actor: KinematicsRef,
  measurements: PlaybackMeasurement[],
  frames: number,
): Array<
  Omit<PlaybackMeasurement, 'previousTime'> & {
    end: { time: number; revision: number; status: string } | undefined;
    valid: boolean;
  }
> {
  return measurements.map(({ previousTime: _previousTime, ...measurement }) => {
    const unit = actor.getSnapshot().context.unitsById[measurement.unitId];
    return {
      ...measurement,
      end: unit ? { time: unit.playback.time, revision: unit.revision, status: unit.playback.status } : undefined,
      valid: measurement.playingSampleFrames === frames && measurement.advancingSampleFrames > 0,
    };
  });
}
