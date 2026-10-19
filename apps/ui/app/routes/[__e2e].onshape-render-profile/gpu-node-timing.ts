import { REVISION, WebGPUCoordinateSystem } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import type { FrameGpuTimer } from '#routes/[__e2e].onshape-render-profile/gpu-timing.js';

type TimedPassDescriptor = { timestampWrites?: unknown };

type TimestampPool = {
  readonly queryOffsets: Map<string, number>;
  readonly timestamps: Map<string, number>;
  resolveQueriesAsync: () => Promise<number>;
};

type TimestampBackend = WebGPURenderer['backend'] & {
  trackTimestamp: boolean;
  initTimestampQuery: (type: string, uid: string, descriptor: TimedPassDescriptor) => void;
  readonly timestampQueryPool: { readonly render?: TimestampPool };
};

/** Diagnose all render passes in a Tau frame; never enable queries in ordinary rendering. */
export function createNodeFrameGpuTimer(renderer: WebGPURenderer): FrameGpuTimer | undefined {
  if (
    REVISION !== '184' ||
    renderer.coordinateSystem !== WebGPUCoordinateSystem ||
    !renderer.hasFeature('timestamp-query')
  ) {
    return undefined;
  }
  // Three r184 declarations omit this backend surface. The source fingerprint and async
  // lifecycle tests guard the adapter; the renderer remains the query-pool owner.
  const backend = renderer.backend as TimestampBackend;
  if (backend.trackTimestamp || (backend.timestampQueryPool.render?.queryOffsets.size ?? 0) > 0) {
    return undefined;
  }
  const completed: number[] = [];
  let active = false;
  let disposed = false;
  let pending: Promise<void> | undefined;
  let failedSamples = 0;
  const descriptors = new Set<TimedPassDescriptor>();
  const originalInitTimestampQuery = backend.initTimestampQuery;
  const initTimestampQuery: TimestampBackend['initTimestampQuery'] = (type, uid, descriptor) => {
    originalInitTimestampQuery.call(backend, type, uid, descriptor);
    if (active && descriptor.timestampWrites) {
      descriptors.add(descriptor);
    }
  };
  backend.initTimestampQuery = initTimestampQuery;

  const stopTracking = (): void => {
    backend.trackTimestamp = false;
    // Three caches its canvas descriptor. Merely disabling trackTimestamp leaves
    // old writes attached to later unsampled passes (including explicit clears).
    for (const descriptor of descriptors) {
      delete descriptor.timestampWrites;
    }
    descriptors.clear();
    active = false;
  };

  const collect = async (pool: TimestampPool, keys: string[]): Promise<void> => {
    try {
      // Its returned number covers only the last Three render call. The pool's
      // resolved per-pass map covers all nested calls made during this Tau frame.
      await pool.resolveQueriesAsync();
      if (disposed) {
        return;
      }
      const values = keys.map((key) => pool.timestamps.get(key));
      if (values.length === 0 || values.some((value) => value === undefined || !Number.isFinite(value) || value < 0)) {
        failedSamples++;
        return;
      }
      completed.push(values.reduce<number>((sum, value) => sum + (value ?? 0), 0));
    } catch {
      if (!disposed) {
        failedSamples++;
      }
    } finally {
      for (const key of keys) {
        pool.timestamps.delete(key);
      }
      pending = undefined;
    }
  };

  return {
    support: { extension: 'WebGPU timestamp-query (sum of render passes)', counterBits: 64 },
    begin() {
      if (disposed || active || pending !== undefined || backend.trackTimestamp) {
        return false;
      }
      active = true;
      backend.trackTimestamp = true;
      return true;
    },
    end() {
      if (!active) {
        return;
      }
      stopTracking();
      const pool = backend.timestampQueryPool.render;
      if (!pool || pool.queryOffsets.size === 0) {
        failedSamples++;
        return;
      }
      pending = collect(pool, [...pool.queryOffsets.keys()]);
    },
    poll() {
      return {
        milliseconds: completed.splice(0),
        pending: Number(Boolean(pending)),
        disjointDiscarded: 0,
        failedSamples,
      };
    },
    dispose() {
      if (active) {
        stopTracking();
      }
      if (backend.initTimestampQuery === initTimestampQuery) {
        backend.initTimestampQuery = originalInitTimestampQuery;
      }
      disposed = true;
      completed.length = 0;
      // In-flight readback can finish, but cannot publish into a retired timer.
      // Do not dispose the borrowed pool: the renderer owns it until teardown.
    },
  };
}
