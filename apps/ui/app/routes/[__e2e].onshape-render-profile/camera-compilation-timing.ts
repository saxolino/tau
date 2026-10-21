import type { WebGPURenderer } from 'three/webgpu';

// Calibration-only adapter for r184's backend pipeline entry point.
type TimedBackend = WebGPURenderer['backend'] & {
  createRenderPipeline: (
    object: Parameters<WebGPURenderer['backend']['createNodeBuilder']>[0],
    ...rest: unknown[]
  ) => void;
};

/** CPU-only node-build and pipeline-creation timing; opt-in calibration instrumentation, never production. */
export const createCameraCompilationTiming = (
  renderer: WebGPURenderer,
): {
  reset: () => void;
  read: () => {
    builds: number;
    milliseconds: number;
    materials: string[];
    pipelineCalls: number;
    pipelineMilliseconds: number;
  };
  dispose: () => void;
} => {
  const backend = renderer.backend as TimedBackend;
  const original = backend.createNodeBuilder;
  let active = true;
  let builds = 0;
  let milliseconds = 0;
  let materials: string[] = [];
  let pipelineCalls = 0;
  let pipelineMilliseconds = 0;
  const originalPipeline = backend.createRenderPipeline;
  const createRenderPipeline: typeof originalPipeline = (...args) => {
    if (!active) {
      originalPipeline.apply(backend, args);
      return;
    }
    const start = performance.now();
    try {
      originalPipeline.apply(backend, args);
    } finally {
      pipelineCalls++;
      pipelineMilliseconds += performance.now() - start;
    }
  };
  backend.createRenderPipeline = createRenderPipeline;
  const createNodeBuilder: typeof original = (...args) => {
    const builder = original.apply(backend, args);
    const { build } = builder;
    builder.build = () => {
      if (!active) {
        return build.call(builder);
      }
      const start = performance.now();
      try {
        return build.call(builder);
      } finally {
        builds++;
        materials.push(args[0].material.type);
        milliseconds += performance.now() - start;
      }
    };
    return builder;
  };
  backend.createNodeBuilder = createNodeBuilder;
  return {
    reset: () => {
      builds = 0;
      milliseconds = 0;
      materials = [];
      pipelineCalls = 0;
      pipelineMilliseconds = 0;
    },
    read: () => ({ builds, milliseconds, materials: [...materials], pipelineCalls, pipelineMilliseconds }),
    dispose: () => {
      active = false;
      if (backend.createRenderPipeline === createRenderPipeline) {
        backend.createRenderPipeline = originalPipeline;
      }
      if (backend.createNodeBuilder === createNodeBuilder) {
        backend.createNodeBuilder = original;
      }
    },
  };
};
