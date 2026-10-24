import { initOcct } from '@taucad/occt-core';
import initialize from 'libcascade/single/init';
import { checkStepExport } from '#services/project-export-step.js';
import type { StepCheckRequest } from '#services/project-export.types.js';

globalThis.addEventListener('message', async (event: MessageEvent<StepCheckRequest>) => {
  try {
    const oc = await initOcct(new URL(import.meta.resolve('libcascade/wasm')).href, initialize);
    globalThis.postMessage(checkStepExport(oc, event.data));
  } catch {
    globalThis.postMessage({ status: 'needsFix', problem: 'read' });
  }
});
