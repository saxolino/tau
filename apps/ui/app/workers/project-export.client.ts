import type { StepCheckRequest, StepCheckResult } from '#services/project-export.types.js';

/** A bounded, disposable worker keeps the independent engine off the UI thread. */
export async function verifyStepInBrowser(request: StepCheckRequest, signal: AbortSignal): Promise<StepCheckResult> {
  signal.throwIfAborted();
  return new Promise((resolve) => {
    const worker = new Worker(new URL('project-export.worker.ts', import.meta.url), { type: 'module' });
    const finish = (result: StepCheckResult): void => {
      clearTimeout(checkTimer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      resolve(result);
    };
    const abort = (): void => {
      finish({ status: 'needsFix', problem: 'changed' });
    };
    const checkTimer = setTimeout(() => {
      finish({ status: 'needsFix', problem: 'read' });
    }, 120_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.addEventListener(
      'message',
      (event: MessageEvent<StepCheckResult>) => {
        finish(event.data);
      },
      { once: true },
    );
    worker.addEventListener(
      'error',
      () => {
        finish({ status: 'needsFix', problem: 'read' });
      },
      { once: true },
    );
    worker.addEventListener(
      'messageerror',
      () => {
        finish({ status: 'needsFix', problem: 'read' });
      },
      { once: true },
    );
    // Clone, never transfer/detach bytes owned by the runtime's export cache.
    try {
      worker.postMessage(request);
    } catch {
      finish({ status: 'needsFix', problem: 'read' });
    }
  });
}
