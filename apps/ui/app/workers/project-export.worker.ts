import { initOcct } from '@taucad/occt-core';
import initialize from 'libcascade/single/init';
import { convertStepToIges } from '#services/project-export-iges.js';
import { checkStepExport } from '#services/project-export-step.js';
import type { IgesConversionRequest, StepCheckRequest } from '#services/project-export.types.js';

// OpenCASCADE (LGPL) in its own disposable worker: the STEP check of the kernels other than SMLib, and the STEP → IGES
// conversion of SinopiaCAD's delivery (SMLib 0.5 reads IGES but does not write it). SMLib models never send their STEP
// here for checking: the delivery worker reads it back.
globalThis.addEventListener('message', async (event: MessageEvent<StepCheckRequest | IgesConversionRequest>) => {
  const request = event.data;
  try {
    const oc = await initOcct(new URL(import.meta.resolve('libcascade/wasm')).href, initialize);
    if ('kind' in request) {
      globalThis.postMessage({ status: 'ready', bytes: convertStepToIges(oc, request.bytes) });
      return;
    }
    globalThis.postMessage(checkStepExport(oc, request));
  } catch {
    globalThis.postMessage({ status: 'needsFix', problem: 'kind' in request ? 'prepare' : 'read' });
  }
});
