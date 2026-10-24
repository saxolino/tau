import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyStepInBrowser } from './project-export.client.js';

const workers: TestWorker[] = [];
class TestWorker extends EventTarget {
  public terminate = vi.fn();
  public postMessage = vi.fn();
  public constructor() {
    super();
    workers.push(this);
  }
}
const request = { bytes: new Uint8Array([1, 2, 3]), expectedNames: ['Anello'] };
beforeEach(() => {
  workers.length = 0;
  vi.stubGlobal('Worker', TestWorker);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('STEP verification worker lifetime', () => {
  it('should return the native result and release the worker without transferring runtime-owned bytes', async () => {
    const pending = verifyStepInBrowser(request, new AbortController().signal);
    expect(workers[0]!.postMessage).toHaveBeenCalledExactlyOnceWith(request);
    const response = { status: 'verified', bytes: request.bytes, pieces: [{ name: 'Anello', solids: 1, valid: true }] };
    workers[0]!.dispatchEvent(new MessageEvent('message', { data: response }));
    expect(await pending).toEqual(response);
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(request.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });
  it('should terminate an aborted check and never claim verification', async () => {
    const controller = new AbortController();
    const pending = verifyStepInBrowser(request, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ status: 'needsFix', problem: 'changed' });
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  });
  it('should terminate a stuck native check when its time budget expires', async () => {
    vi.useFakeTimers();
    const pending = verifyStepInBrowser(request, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await pending).toEqual({ status: 'needsFix', problem: 'read' });
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  });
  it('should report a worker failure and release its memory', async () => {
    const pending = verifyStepInBrowser(request, new AbortController().signal);
    workers[0]!.dispatchEvent(new Event('error'));
    expect(await pending).toEqual({ status: 'needsFix', problem: 'read' });
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  });
});
