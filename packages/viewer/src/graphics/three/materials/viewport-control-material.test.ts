import { describe, expect, it } from 'vitest';
import { Texture } from 'three';
import {
  createViewportControlLabelMaterial,
  createViewportControlSelectorLabelMaterial,
} from '#graphics/three/materials/viewport-control-material.js';

describe('viewport-control-material', () => {
  it.each(['webgl', 'webgpu'] as const)(
    'should create transparent depth-disabled %s material for overlay labels',
    (backend) => {
      const material = createViewportControlLabelMaterial({ map: new Texture(), backend });

      expect(material.transparent).toBe(true);
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
      expect(material.toneMapped).toBe(false);
    },
  );

  it('should create blended depth-compatible basic material for selector labels', () => {
    const material = createViewportControlSelectorLabelMaterial({ map: new Texture() });

    expect(material.transparent).toBe(true);
    expect(material.alphaTest).toBe(0);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.toneMapped).toBe(false);
  });
});
