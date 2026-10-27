import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryComponentManifest } from '@taucad/types';
import { createModelAssembly, modelAssemblyStep } from '#graphics/three/react/model-assembly.js';

const request = { key: 'turn-1', stepMilliseconds: 400, holdMilliseconds: 2000 } as const;
const buckle = ['telaio', 'traversa', 'ardiglione'] as const;
const manifest = { nodeOrder: [...buckle], nodesById: {} } as unknown as GeometryComponentManifest;

describe('createModelAssembly', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Playing ────────────────────────────────────────────────────────────────

  it('should draw the first piece at once and the others one step apart when an armed first model arrives', () => {
    const assembly = createModelAssembly();
    assembly.arm(request);

    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });

    expect(assembly.hiddenComponentIds()).toEqual(['traversa', 'ardiglione']);
    vi.advanceTimersByTime(399);
    expect(assembly.hiddenComponentIds()).toEqual(['traversa', 'ardiglione']);
    vi.advanceTimersByTime(1);
    expect(assembly.hiddenComponentIds()).toEqual(['ardiglione']);
    vi.advanceTimersByTime(400);
    expect(assembly.hiddenComponentIds()).toEqual([]);
    expect(assembly.getSnapshot().run).toMatchObject({ entered: 3, isComplete: true });
  });

  it('should end the run once the pieces have been named for the hold', () => {
    const assembly = createModelAssembly();
    assembly.arm(request);
    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });

    vi.advanceTimersByTime(800 + 1999);
    expect(assembly.getSnapshot().run).toBeDefined();
    vi.advanceTimersByTime(1);
    expect(assembly.getSnapshot().run).toBeUndefined();
  });

  it('should draw every piece at once without a step, for reduced motion', () => {
    const assembly = createModelAssembly();
    assembly.arm({ ...request, stepMilliseconds: 0 });

    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });

    expect(assembly.hiddenComponentIds()).toEqual([]);
    expect(assembly.getSnapshot().run).toMatchObject({ entered: 3, isComplete: true });
  });

  // ── When it plays ──────────────────────────────────────────────────────────

  it('should draw a model whole when nothing is armed', () => {
    const assembly = createModelAssembly();

    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });

    expect(assembly.hiddenComponentIds()).toEqual([]);
    expect(assembly.getSnapshot().run).toBeUndefined();
  });

  it('should draw a model whole when it replaces one that had pieces', () => {
    const assembly = createModelAssembly();
    assembly.arm(request);

    assembly.present({ componentIds: buckle, manifest, previousCount: 2 });

    expect(assembly.getSnapshot().run).toBeUndefined();
    expect(assembly.getSnapshot().request).toEqual(request);
  });

  it('should end a run still entering when the agent rebuilds the model, so the new scene is drawn whole', () => {
    const assembly = createModelAssembly();
    assembly.arm(request);
    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });
    expect(assembly.hiddenComponentIds()).toEqual(['traversa', 'ardiglione']);

    assembly.present({ componentIds: buckle, manifest, previousCount: 3 });

    expect(assembly.hiddenComponentIds()).toEqual([]);
    expect(assembly.getSnapshot().run).toBeUndefined();
  });

  it('should play a key once and ignore arming it again', () => {
    const assembly = createModelAssembly();
    assembly.arm(request);
    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });
    assembly.finish();

    assembly.arm(request);
    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });

    expect(assembly.getSnapshot()).toMatchObject({ request: undefined, run: undefined, playedKey: 'turn-1' });
  });

  // ── Interaction ────────────────────────────────────────────────────────────

  it('should draw every piece and end the run when finished early', () => {
    const assembly = createModelAssembly();
    assembly.arm(request);
    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });

    assembly.finish();
    vi.advanceTimersByTime(5000);

    expect(assembly.hiddenComponentIds()).toEqual([]);
    expect(assembly.getSnapshot().run).toBeUndefined();
  });

  it('should keep the hidden list while only the anchors move', () => {
    const assembly = createModelAssembly();
    assembly.arm(request);
    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });
    const hidden = assembly.hiddenComponentIds();
    const listener = vi.fn();
    assembly.subscribe(listener);

    assembly.measure({ telaio: { x: 100, y: 80 } }, { width: 400, height: 300 });
    assembly.measure({ telaio: { x: 100.4, y: 80.2 } }, { width: 400, height: 300 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(assembly.hiddenComponentIds()).toBe(hidden);
    expect(assembly.getSnapshot().run?.anchors).toEqual({ telaio: { x: 100, y: 80 } });
  });

  it('should stop its timers when disposed', () => {
    const assembly = createModelAssembly();
    assembly.arm(request);
    assembly.present({ componentIds: buckle, manifest, previousCount: 0 });

    assembly.dispose();
    vi.advanceTimersByTime(5000);

    expect(assembly.getSnapshot().run).toMatchObject({ entered: 1 });
  });
});

describe('modelAssemblyStep', () => {
  it('should keep the requested step for a few pieces', () => {
    expect(modelAssemblyStep(3, 380)).toBe(380);
  });

  it('should shorten the step so many pieces still enter within three seconds', () => {
    expect(modelAssemblyStep(31, 380)).toBe(100);
  });

  it('should not wait for a single piece', () => {
    expect(modelAssemblyStep(1, 380)).toBe(0);
  });
});
