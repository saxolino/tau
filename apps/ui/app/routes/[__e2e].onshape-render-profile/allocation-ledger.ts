import { CubeTexture, REVISION, WebGLCoordinateSystem } from 'three';
import type { RenderTarget, Texture } from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { createNodeFrameGpuTimer } from '#routes/[__e2e].onshape-render-profile/gpu-node-timing.js';

// Calibration-only r184 adapter. Scalar receipts never retain a disposed GPU resource.
type TextureRecord = {
  id: string;
  name: string;
  width: number;
  height: number;
  layers: number;
  type: number;
  format: number;
  mipmaps: boolean;
  trackedBytes: number;
  live: boolean;
  backendLive: boolean;
  descriptor?: unknown;
  multisample?: { width: number; height: number; layers: number; samples: number; format: string };
  renderbuffers?: Array<Record<string, number | string>>;
  origin: string;
};
type PassContext = {
  // oxlint-disable-next-line typescript/no-restricted-types -- Three uses null for the canvas target.
  textures: Texture[] | null;
  depthTexture?: Texture;
  renderTarget?: RenderTarget;
  width: number;
  height: number;
  sampleCount: number;
  clearColor: boolean;
  clearDepth: boolean;
  clearStencil: boolean;
};
type ObservedBackend = WebGPURenderer['backend'] & {
  createTexture: (texture: Texture, options?: Record<string, unknown>) => void;
  destroyTexture: (texture: Texture, isDefaultTexture?: boolean) => void;
  get: (texture: Texture | RenderTarget) => unknown;
  beginRender: (context: PassContext) => void;
  finishRender: (context: PassContext) => void;
  draw: (object: { context: PassContext }, ...rest: unknown[]) => void;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Match the private Three method name.
  getTimestampUID: (context: PassContext) => string;
};
type Ledger = {
  revision: string;
  backend: 'webgpu' | 'webgl2-node';
  costStatus?: Record<string, unknown>;
  records: Map<string, TextureRecord>;
  events: Array<{ event: string; id: string; at: number; bytes: number }>;
  passes: Map<string, unknown>;
  costs: number[];
  timingEnabled: boolean;
  peak: number;
  disposed: boolean;
};
const ledgers: Ledger[] = [];

/** Exclude compilation and idle startup samples before a controlled workload. */
export function resetAllocationCosts(enabled = true): void {
  for (const ledger of ledgers) {
    if (!ledger.disposed) {
      if (enabled) {
        ledger.costs.length = 0;
      }
      ledger.timingEnabled = enabled;
    }
  }
}

/** Read logical attachment precision once, preserving the caller's GL binding. */
function readMaskRenderbuffers(
  gl: WebGL2RenderingContext,
  color: WebGLRenderbuffer,
  depth: WebGLRenderbuffer | undefined,
): Array<Record<string, number | string>> {
  // oxlint-disable-next-line typescript/no-restricted-types -- WebGL uses null for an unbound renderbuffer.
  const previous = gl.getParameter(gl.RENDERBUFFER_BINDING) as WebGLRenderbuffer | null;
  const buffers: Array<Record<string, number | string>> = [];
  try {
    for (const [kind, buffer] of [
      ['color', color],
      ['depth', depth],
    ] as const) {
      if (!buffer) {
        continue;
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
      const receipt: Record<string, number | string> = { kind };
      for (const [key, parameter] of Object.entries({
        width: gl.RENDERBUFFER_WIDTH,
        height: gl.RENDERBUFFER_HEIGHT,
        samples: gl.RENDERBUFFER_SAMPLES,
        format: gl.RENDERBUFFER_INTERNAL_FORMAT,
        red: gl.RENDERBUFFER_RED_SIZE,
        green: gl.RENDERBUFFER_GREEN_SIZE,
        blue: gl.RENDERBUFFER_BLUE_SIZE,
        alpha: gl.RENDERBUFFER_ALPHA_SIZE,
        depth: gl.RENDERBUFFER_DEPTH_SIZE,
      })) {
        receipt[key] = gl.getRenderbufferParameter(gl.RENDERBUFFER, parameter) as number;
      }
      buffers.push(receipt);
    }
  } finally {
    gl.bindRenderbuffer(gl.RENDERBUFFER, previous);
  }
  return buffers;
}

/** Snapshot historical allocations without retaining renderer, texture or backend objects. */
export function readAllocationLedgers(): unknown {
  return ledgers.map((ledger) => ({
    revision: ledger.revision,
    backend: ledger.backend,
    costStatus: ledger.costStatus,
    textures: [...ledger.records.values()],
    events: ledger.events,
    passes: [...ledger.passes.values()],
    costs: ledger.costs,
    trackedLive: [...ledger.records.values()]
      .filter((record) => record.live)
      .reduce((sum, record) => sum + record.trackedBytes, 0),
    peak: ledger.peak,
    disposed: ledger.disposed,
  }));
}

/** Install only before first use, only in the separate calibration build. */
export function installAllocationLedger(renderer: WebGPURenderer, passCost?: string): void {
  if (REVISION !== '184') {
    throw new Error('Allocation adapter requires Three r184 source review');
  }
  const ledger: Ledger = {
    revision: REVISION,
    backend: renderer.coordinateSystem === WebGLCoordinateSystem ? 'webgl2-node' : 'webgpu',
    records: new Map(),
    events: [],
    passes: new Map(),
    costs: [],
    timingEnabled: false,
    peak: 0,
    disposed: false,
  };
  ledgers.push(ledger);
  const backend = renderer.backend as ObservedBackend;
  const { info } = renderer;
  const started = performance.now();
  const recordTexture = (texture: Texture): TextureRecord => {
    let record = ledger.records.get(texture.uuid);
    if (!record) {
      record = {
        id: texture.uuid,
        name: texture.name,
        width: texture.width,
        height: texture.height,
        layers: texture instanceof CubeTexture ? 6 : texture.depth,
        type: texture.type,
        format: texture.format,
        mipmaps: texture.generateMipmaps,
        trackedBytes: 0,
        live: false,
        backendLive: false,
        origin: new Error('Allocation origin').stack?.split('\n').slice(2, 14).join('\n') ?? '',
      };
      ledger.records.set(texture.uuid, record);
    }
    record.name = texture.name;
    record.format = texture.format;
    record.type = texture.type;
    record.width = texture.width;
    record.height = texture.height;
    return record;
  };
  const event = (kind: string, record: TextureRecord): void => {
    ledger.events.push({
      event: kind,
      id: record.id,
      at: performance.now() - started,
      bytes: info.memory.texturesSize,
    });
    ledger.peak = Math.max(ledger.peak, info.memory.texturesSize);
  };
  const create = info.createTexture.bind(info);
  info.createTexture = (texture) => {
    const before = info.memory.texturesSize;
    create(texture);
    const record = recordTexture(texture);
    record.trackedBytes = info.memory.texturesSize - before;
    record.live = true;
    event('track', record);
  };
  const destroy = info.destroyTexture.bind(info);
  info.destroyTexture = (texture) => {
    destroy(texture);
    const record = recordTexture(texture);
    record.live = false;
    event('untrack', record);
  };
  const allocate = backend.createTexture.bind(backend);
  backend.createTexture = (texture, options) => {
    allocate(texture, options);
    const record = recordTexture(texture);
    const data = backend.get(texture) as {
      textureDescriptorGPU?: unknown;
      glInternalFormat?: number;
      glType?: number;
      glFormat?: number;
      msaaTexture?: GPUTexture;
    };
    record.descriptor = (data.textureDescriptorGPU ? structuredClone(data.textureDescriptorGPU) : undefined) ?? {
      width: options?.['width'],
      height: options?.['height'],
      depth: options?.['depth'],
      levels: options?.['levels'],
      sampleCount: options?.['sampleCount'],
      internalFormat: data.glInternalFormat,
      type: data.glType,
      format: data.glFormat,
    };
    if (data.msaaTexture) {
      const msaa = data.msaaTexture;
      record.multisample = {
        width: msaa.width,
        height: msaa.height,
        layers: msaa.depthOrArrayLayers,
        samples: msaa.sampleCount,
        format: msaa.format,
      };
    }
    record.backendLive = true;
    event('allocate', record);
  };
  const release = backend.destroyTexture.bind(backend);
  backend.destroyTexture = (texture, isDefaultTexture) => {
    release(texture, isDefaultTexture);
    const record = recordTexture(texture);
    record.backendLive = false;
    event('release', record);
  };
  const timer = passCost ? createNodeFrameGpuTimer(renderer) : undefined;
  if (passCost) {
    ledger.costStatus = { stage: passCost, support: timer?.support ?? 'unavailable' };
  }
  const glBackend = renderer.coordinateSystem === WebGLCoordinateSystem;
  const passNames = new WeakMap<PassContext, string>();
  const inspectedBuffers = new WeakSet<WebGLRenderbuffer>();
  let timedContext: PassContext | undefined;
  let timedUid = '';
  let frame = -1;
  let composites = 0;
  const begin = backend.beginRender.bind(backend);
  backend.beginRender = (context) => {
    const textures = context.textures ?? [];
    const names = new Set(textures.map((texture) => texture.name));
    if (frame !== info.frame) {
      frame = info.frame;
      composites = 0;
    }
    const name =
      context.textures === null
        ? 'output'
        : names.has('output')
          ? 'scene'
          : names.has('GTAONode.AO')
            ? 'ao'
            : names.has('Tau linear frame')
              ? ++composites === 1
                ? 'compose'
                : 'overlay'
              : context.width === 1280 && context.height === 720
                ? 'filter'
                : 'other';
    passNames.set(context, name);
    const uid = backend.getTimestampUID(context);
    ledger.passes.set(`${name}:${textures.map((texture) => texture.uuid).join(',')}`, {
      uid,
      name,
      width: context.width,
      height: context.height,
      samples: context.sampleCount,
      color: textures.map((texture) => texture.uuid),
      depth: context.depthTexture?.uuid,
      clearColor: context.clearColor,
      clearDepth: context.clearDepth,
      clearStencil: context.clearStencil,
    });
    if (timer) {
      const completed = timer.poll();
      ledger.costStatus = {
        stage: passCost,
        support: timer.support,
        pending: completed.pending,
        failedSamples: completed.failedSamples,
        disjointDiscarded: completed.disjointDiscarded,
      };
      if (completed.passRanges?.length) {
        const completedUid = timedUid;
        for (const ranges of completed.passRanges) {
          const selected = ranges.find((range) => range.uid === completedUid);
          if (selected) {
            ledger.costs.push(selected.end - selected.start);
          }
        }
      } else {
        ledger.costs.push(...completed.milliseconds);
      }
      if (!glBackend && ledger.timingEnabled && name === passCost && timer.begin()) {
        timedContext = context;
        timedUid = uid;
      }
    }
    begin(context);
    // One synchronous inspection per mask allocation, before warmed timing. Never retain
    // live renderbuffers in the scalar ledger or query them on ordinary timed frames.
    if (glBackend && names.has('tau-emphasis-mask') && context.renderTarget) {
      const data = backend.get(context.renderTarget) as {
        msaaRenderbuffers?: WebGLRenderbuffer[];
        depthRenderbuffer?: WebGLRenderbuffer;
      };
      const color = data.msaaRenderbuffers?.[0];
      if (color && !inspectedBuffers.has(color)) {
        inspectedBuffers.add(color);
        const gl = renderer.getContext() as WebGL2RenderingContext;
        recordTexture(textures[0]!).renderbuffers = readMaskRenderbuffers(gl, color, data.depthRenderbuffer);
      }
    }
  };
  const draw = backend.draw.bind(backend);
  backend.draw = (object, ...rest) => {
    // GL elapsed queries start after nested dependency passes, immediately before this pass's first draw.
    if (
      glBackend &&
      ledger.timingEnabled &&
      passNames.get(object.context) === passCost &&
      !timedContext &&
      timer?.begin()
    ) {
      timedContext = object.context;
    }
    draw(object, ...rest);
  };
  const finish = backend.finishRender.bind(backend);
  backend.finishRender = (context) => {
    finish(context);
    if (context === timedContext) {
      timer?.end();
      timedContext = undefined;
    }
  };
  const dispose = renderer.dispose.bind(renderer);
  renderer.dispose = () => {
    timer?.dispose();
    dispose();
    ledger.disposed = true;
  };
}
