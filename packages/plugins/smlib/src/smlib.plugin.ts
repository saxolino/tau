import { definePlugin } from '@taucad/runtime/plugin';
import { smlibManualSidecar } from '#smlib-manual.middleware.js';
import { smlibKernel } from '#smlib.kernel.js';

/** Canonical `@taucad/smlib` plugin factory. @public */
export const smlib = definePlugin({
  meta: {
    name: '@taucad/smlib',
  },

  kernels: {
    default: smlibKernel,
  },

  middleware: { manualSidecar: smlibManualSidecar },

  presets: {
    default: ['kernels.default', 'middleware.manualSidecar'],
  },
});
