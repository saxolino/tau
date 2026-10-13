/**
 * 1. Correlated cancel requests wait for backend settlement.
 * 2. Successful/failed resource settlement reaches ended with inspectable error.
 * 3. The public alphabet is total; both reachable states are enumerated.
 * The handwritten ProjectTaskDispatch model's Cancel/Settled/Failed actions map to the same named transitions.
 */
import { toPromise } from 'xstate';
import { describe, expect, it, vi } from 'vitest';
import { StepClock, flush } from '@taucad/xstate-testing/clock';
import { guardActors } from '@taucad/xstate-testing/inspect';
import { pathTable, unansweredEvents, unreachedStates } from '@taucad/xstate-testing/paths';
import { createProjectTaskDispatch } from '#project-tasks/dispatch.js';
import { projectTaskDispatchMachine, projectTaskDispatchIgnoredEvents } from '#project-tasks/dispatch.machine.js';

const input = { projectId: 'project', taskId: 'task', attemptId: 'attempt' };
const graph = {
  input,
  events: [
    { type: 'cancel', attemptId: 'attempt' },
    { type: 'cancel', attemptId: 'obsolete' },
    { type: 'xstate.done.actor.0.projectTaskDispatch.executing', output: undefined },
    { type: 'xstate.error.actor.0.projectTaskDispatch.executing', error: new Error('fixture') },
  ],
  limit: 100,
  serializeState: (snapshot: { value: unknown }) => JSON.stringify(snapshot.value),
};

describe('project task dispatch owner', () => {
  it('correlates cancellation and waits until the backend has released resources', async () => {
    const guard = guardActors({ ignore: { projectTaskDispatch: projectTaskDispatchIgnoredEvents } });
    const done = Promise.withResolvers<void>();
    const cancel = vi.fn();
    const actor = createProjectTaskDispatch({
      input,
      effects: { execute: async () => done.promise, cancel },
      clock: new StepClock(),
      inspect: guard.inspect,
    });
    actor.start();
    actor.send({ type: 'cancel', attemptId: 'obsolete' });
    expect(cancel).not.toHaveBeenCalled();
    actor.send({ type: 'cancel', attemptId: 'attempt' });
    expect(cancel).toHaveBeenCalledExactlyOnceWith('attempt');
    expect(actor.getSnapshot().value).toBe('executing');
    done.resolve();
    expect(await toPromise(actor)).toEqual({ error: undefined });
    expect(actor.getSnapshot().value).toBe('ended');
  });

  it('keeps an effect failure inspectable after settlement', async () => {
    const guard = guardActors({ ignore: { projectTaskDispatch: projectTaskDispatchIgnoredEvents } });
    const actor = createProjectTaskDispatch({
      input,
      effects: {
        execute: async () => {
          throw new Error('release failed');
        },
        cancel: () => undefined,
      },
      clock: new StepClock(),
      inspect: guard.inspect,
    });
    actor.start();
    const result = await toPromise(actor);
    expect(result.error).toContain('release failed');
    await flush();
    guard.take('fault');
  });

  it('answers all sampled public events and reaches both protocol states', () => {
    expect(
      unansweredEvents(projectTaskDispatchMachine, { ...graph, ignore: projectTaskDispatchIgnoredEvents }),
    ).toEqual([]);
    expect(unreachedStates(projectTaskDispatchMachine, graph)).toEqual([]);
    expect(pathTable(projectTaskDispatchMachine, graph).map((row) => row.state)).toEqual(
      expect.arrayContaining(['executing', 'ended']),
    );
  });
});
