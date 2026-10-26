import { defineMiddleware } from '@taucad/runtime/middleware';
import { manualEntryPath } from '#manual-operations.js';

/** Watch optional manual history without reporting absent sidecars as broken source imports. @public */
export const smlibManualSidecar = defineMiddleware({
  id: 'smlibManualSidecar',
  name: 'SMLib manual sidecar',
  version: '1.0.0',
  resolve({ entryPath }) {
    return [{ path: manualEntryPath(entryPath), affects: ['evaluate'], watchDebounce: 0 }];
  },
  async wrapEvaluate(input, handler) {
    return handler(input);
  },
});
