import { afterEach, describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import type { Mechanism } from '@taucad/kinematics';
import { kinematicsMachine } from '@taucad/viewer/machines/kinematics.machine';
import {
  finishBenchmarkPlayback,
  prepareBenchmarkPlayback,
  sampleBenchmarkPlayback,
} from '#routes/[__e2e].onshape-render-profile/benchmark-playback.js';

const actors: Array<ReturnType<typeof createActor<typeof kinematicsMachine>>> = [];
const createFixture = (loop: 'repeat' | 'none' = 'repeat') => {
  const mechanism: Mechanism = {
    schemaVersion: 1,
    units: { length: 'm', angle: 'rad' },
    root: 'base',
    links: { base: { components: ['base'] }, arm: { components: ['arm'] } },
    joints: { hinge: { type: 'revolute', parent: 'base', child: 'arm', origin: [0, 0, 0], axis: [0, 0, 1] } },
    animations: [
      {
        id: 'turn',
        duration: 1,
        loop,
        keyframes: [
          { time: 0, coordinates: { hinge: 0 } },
          { time: 1, coordinates: { hinge: 1 } },
        ],
      },
    ],
  };
  const actor = createActor(kinematicsMachine, { input: {} }).start();
  actors.push(actor);
  actor.send({ type: 'loadMechanism', unitId: 'gear', mechanism });
  return actor;
};
afterEach(() => {
  for (const actor of actors) {
    actor.stop();
  }
  actors.length = 0;
});

describe('calibration playback workload', () => {
  it('records actual repeating motion and a fresh start for every run', () => {
    const actor = createFixture();
    actor.send({ type: 'seek', unitId: 'gear', time: 0.5 });
    const measurement = prepareBenchmarkPlayback(actor, true);
    expect(measurement[0]!.start.time).toBe(0);
    for (let index = 0; index < 3; index++) {
      actor.send({ type: 'tick', unitId: 'gear', elapsed: 0.5 });
      sampleBenchmarkPlayback(actor, measurement);
    }
    expect(finishBenchmarkPlayback(actor, measurement, 3)[0]).toMatchObject({
      valid: true,
      playingSampleFrames: 3,
      advancingSampleFrames: 3,
      end: { time: 1.5, status: 'playing' },
    });
    expect(prepareBenchmarkPlayback(actor, true)[0]!.start.time).toBe(0);
  });

  it('rejects stopped clips and non-advancing motion', () => {
    const actor = createFixture('none');
    const measurement = prepareBenchmarkPlayback(actor, true);
    actor.send({ type: 'tick', unitId: 'gear', elapsed: 2 });
    sampleBenchmarkPlayback(actor, measurement);
    expect(finishBenchmarkPlayback(actor, measurement, 1)[0]!.valid).toBe(false);
    const still = prepareBenchmarkPlayback(actor, true);
    sampleBenchmarkPlayback(actor, still);
    expect(finishBenchmarkPlayback(actor, still, 1)[0]!.valid).toBe(false);
  });

  it('keeps orbit-only units paused and reports no motion for absent mechanisms', () => {
    const actor = createFixture();
    prepareBenchmarkPlayback(actor, true);
    expect(prepareBenchmarkPlayback(actor, false)).toEqual([]);
    expect(actor.getSnapshot().context.unitsById['gear']!.playback.status).toBe('paused');
    actor.send({ type: 'clearMechanism', unitId: 'gear' });
    expect(prepareBenchmarkPlayback(actor, true)).toEqual([]);
  });
});
