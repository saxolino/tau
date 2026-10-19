import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { transformRenderingAblation } from '#routes/[__e2e].onshape-render-profile/ablation-transform.js';

const root = resolve(import.meta.dirname, '../../../../..');
const files = [
  'packages/viewer/src/graphics/three/post-processing-webgpu.tsx',
  'packages/viewer/src/graphics/three/post-processing.tsx',
  'packages/viewer/src/graphics/three/renderer.ts',
  'packages/viewer/src/graphics/three/scene-overlay.tsx',
  'apps/ui/app/routes/[__e2e].onshape-render-profile/route.tsx',
];

describe('calibration-only rendering ablation', () => {
  it.each(files)('checks every source anchor in %s', (file) => {
    const code = readFileSync(resolve(root, file), 'utf8');
    expect(transformRenderingAblation(code, `/${file}`)).toContain('const tauAblation');
    expect(() => transformRenderingAblation('', `/${file}`)).toThrow('anchor drift');
  });

  it('does not alter unrelated product modules', () => {
    expect(transformRenderingAblation('unchanged', '/graphics/three/unrelated.tsx')).toBeUndefined();
  });

  it('does not install experiment transforms in the product configuration', () => {
    expect(readFileSync(resolve(root, 'apps/ui/vite.config.ts'), 'utf8')).not.toContain('transformRenderingAblation');
  });
});
