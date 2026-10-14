import type { RendererInstance } from '#graphics/three/renderer.js';

type CanvasOwner = { renderer: RendererInstance | undefined; invalidate: () => void; disposed: boolean };
type RendererLease = ((renderer: RendererInstance) => void) & { cancel: () => void };
type ExtensionLookup = { get: (name: string) => unknown };
const owners = new WeakMap<HTMLCanvasElement, CanvasOwner>();

function isExtensionLookup(value: unknown): value is ExtensionLookup {
  return typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function';
}

function resetSurvivor(canvas: HTMLCanvasElement, retired: CanvasOwner): void {
  const survivor = owners.get(canvas);
  if (survivor && survivor !== retired && survivor.renderer && 'resetState' in survivor.renderer) {
    survivor.renderer.resetState();
    survivor.invalidate();
  }
}

/**
 * Claims a canvas before asynchronous construction starts. The lease, rather than
 * completion order, decides which renderer may release the shared WebGL context.
 * @param canvas - The actual canvas shared by successive owners.
 * @param invalidate - Requests a frame after restoring a surviving renderer's state.
 * @returns An attachment function for the constructed renderer.
 */
export function claimCanvasRenderer(canvas: HTMLCanvasElement, invalidate: () => void): RendererLease {
  const previous = owners.get(canvas);
  const owner: CanvasOwner = { renderer: undefined, invalidate, disposed: false };
  owners.set(canvas, owner);
  const attach = (renderer: RendererInstance): void => {
    owner.renderer = renderer;
    const canLoseContext = (): boolean => !owners.has(canvas) || owners.get(canvas) === owner;
    if ('forceContextLoss' in renderer) {
      const forceContextLoss = renderer.forceContextLoss.bind(renderer);
      renderer.forceContextLoss = () => {
        if (canLoseContext()) {
          forceContextLoss();
        }
      };
    }
    const dispose: () => unknown = renderer.dispose.bind(renderer);
    renderer.dispose = (): void | Promise<unknown> => {
      if (owner.disposed) {
        return;
      }
      owner.disposed = true;
      if (owners.get(canvas) === owner) {
        owners.delete(canvas);
      }
      // Three r184's initialized WebGL fallback releases its context *inside*
      // backend.dispose(). Keep that implementation (and all resource cleanup),
      // gating only this backend's lookup, never the shared native extension.
      const backend = 'backend' in renderer ? renderer.backend : undefined;
      const extensions =
        backend && 'isWebGLBackend' in backend && backend.isWebGLBackend && 'extensions' in backend
          ? backend.extensions
          : undefined;
      const lookup = isExtensionLookup(extensions) ? extensions : undefined;
      const originalGet = lookup?.get;
      const getDescriptor = lookup ? Object.getOwnPropertyDescriptor(lookup, 'get') : undefined;
      if (lookup && originalGet) {
        lookup.get = (name) => {
          const extension = originalGet.call(lookup, name);
          if (
            name !== 'WEBGL_lose_context' ||
            typeof extension !== 'object' ||
            extension === null ||
            !('loseContext' in extension) ||
            typeof extension.loseContext !== 'function'
          ) {
            return extension;
          }
          const { loseContext } = extension;
          return {
            loseContext: () => {
              if (canLoseContext()) {
                Reflect.apply(loseContext, extension, []);
              }
            },
          };
        };
      }
      const finish = (): void => {
        if (lookup && originalGet) {
          if (getDescriptor) {
            Object.defineProperty(lookup, 'get', getDescriptor);
          } else {
            Reflect.deleteProperty(lookup, 'get');
          }
        }
        resetSurvivor(canvas, owner);
      };
      try {
        const result: unknown = dispose();
        if (typeof result === 'object' && result !== null && 'then' in result && typeof result.then === 'function') {
          return Promise.resolve(result).finally(finish);
        }
      } catch (error) {
        finish();
        throw error;
      }
      finish();
    };
    // A late constructor can reset shared GL defaults before its factory settles.
    resetSurvivor(canvas, owner);
  };
  return Object.assign(attach, {
    cancel: () => {
      owner.disposed = true;
      if (owners.get(canvas) === owner) {
        if (previous && !previous.disposed) {
          owners.set(canvas, previous);
        } else {
          owners.delete(canvas);
        }
      }
      resetSurvivor(canvas, owner);
    },
  });
}
