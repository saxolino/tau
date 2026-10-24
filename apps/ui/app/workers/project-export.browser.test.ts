import { describe, expect, it } from 'vitest';
import fixture from './fixtures/project-export-assembly.step?raw';
import { verifyStepInBrowser } from './project-export.client.js';

describe('independent STEP browser worker', () => {
  it('should read real solids and their names in WASM, including a selected-piece round trip', async () => {
    const result = await verifyStepInBrowser(
      { bytes: new TextEncoder().encode(fixture), expectedNames: ['cubeA', 'cubeB'], selectedNames: ['cubeB'] },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ status: 'verified', pieces: [{ name: 'cubeB', solids: 1, valid: true }] });
  });
  it('should refuse malformed STEP bytes in the browser', async () => {
    expect(
      await verifyStepInBrowser(
        { bytes: new TextEncoder().encode('INVALID STEP'), expectedNames: ['cubeA'] },
        new AbortController().signal,
      ),
    ).toEqual({ status: 'needsFix', problem: 'read' });
  });
  it('should terminate an abandoned check without retaining its geometry worker', async () => {
    const controller = new AbortController();
    const pending = verifyStepInBrowser(
      { bytes: new TextEncoder().encode(fixture), expectedNames: ['cubeA', 'cubeB'] },
      controller.signal,
    );
    controller.abort();
    expect(await pending).toEqual({ status: 'needsFix', problem: 'changed' });
  });
});
