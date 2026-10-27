import type {
  IgesConversionRequest,
  IgesConversionResult,
  StepCheckRequest,
  StepCheckResult,
} from '#services/project-export.types.js';

/** A bounded, disposable worker keeps the independent engine off the UI thread. */
export async function verifyStepInBrowser(request: StepCheckRequest, signal: AbortSignal): Promise<StepCheckResult> {
  return inOcctWorker<StepCheckRequest, StepCheckResult>(request, signal, 'read');
}

/**
 * STEP → IGES in the same disposable OpenCASCADE worker (E3a): SMLib 0.5 reads IGES but does not write it. Rejects
 * when the conversion fails; the IGES is checked afterwards by reading it back with SMLib.
 */
export async function convertIgesInBrowser(
  step: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  const result = await inOcctWorker<IgesConversionRequest, IgesConversionResult>(
    { kind: 'iges', bytes: step },
    signal,
    'prepare',
  );
  if (result.status !== 'ready') {
    throw new Error('IGES_CONVERSION_FAILED');
  }
  return result.bytes;
}

async function inOcctWorker<Request, Result>(
  request: Request,
  signal: AbortSignal,
  failure: 'read' | 'prepare',
): Promise<Result> {
  signal.throwIfAborted();
  type Failed = { status: 'needsFix'; problem: 'changed' | 'read' | 'prepare' };
  return new Promise((resolve) => {
    const worker = new Worker(new URL('project-export.worker.ts', import.meta.url), { type: 'module' });
    const finish = (result: Result | Failed): void => {
      clearTimeout(checkTimer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      resolve(result as Result);
    };
    const abort = (): void => {
      finish({ status: 'needsFix', problem: 'changed' });
    };
    const checkTimer = setTimeout(() => {
      finish({ status: 'needsFix', problem: failure });
    }, 120_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.addEventListener(
      'message',
      (event: MessageEvent<Result>) => {
        finish(event.data);
      },
      { once: true },
    );
    worker.addEventListener(
      'error',
      () => {
        finish({ status: 'needsFix', problem: failure });
      },
      { once: true },
    );
    worker.addEventListener(
      'messageerror',
      () => {
        finish({ status: 'needsFix', problem: failure });
      },
      { once: true },
    );
    // Clone, never transfer/detach bytes owned by the runtime's export cache.
    try {
      worker.postMessage(request);
    } catch {
      finish({ status: 'needsFix', problem: failure });
    }
  });
}
