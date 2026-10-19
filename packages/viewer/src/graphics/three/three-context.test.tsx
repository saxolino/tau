import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThreeProvider } from '#graphics/three/three-context.jsx';
import { WebglErrorBoundary } from '#cad/webgl-error-boundary.jsx';
import { WebGpuInitializationError } from '#graphics/three/webgpu-initialization-error.js';
import type { ThreeContextProperties } from '#graphics/three/three-viewer-properties.js';

const allocation = vi.hoisted(() => ({ error: undefined as Error | undefined }));
vi.mock('#graphics/three/three-canvas-instance.jsx', () => ({
  ThreeCanvasInstance: ({ graphicsBackend, children }: ThreeContextProperties) => {
    if (graphicsBackend === 'webgpu' && allocation.error) {
      throw allocation.error;
    }
    return <div aria-label={`${graphicsBackend} canvas`}>{children}</div>;
  },
}));

describe('ThreeProvider initialization recovery', () => {
  beforeEach(() => {
    allocation.error = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should remount WebGL after WebGPU initialization fails and retry WebGPU after a preference change', () => {
    const view = render(<ThreeProvider graphicsBackend='webgpu'>Model</ThreeProvider>);
    const gpuCanvas = screen.getByLabelText('webgpu canvas');
    allocation.error = new WebGpuInitializationError('Device request failed');
    view.rerender(<ThreeProvider graphicsBackend='webgpu'>Updated model</ThreeProvider>);
    expect(gpuCanvas).not.toBeInTheDocument();
    expect(screen.getByLabelText('webgl canvas')).toHaveTextContent('Updated model');
    allocation.error = undefined;
    view.rerender(<ThreeProvider graphicsBackend='webgpu'>Another update</ThreeProvider>);
    expect(screen.getByLabelText('webgl canvas')).toHaveTextContent('Another update');
    view.rerender(<ThreeProvider graphicsBackend='webgl'>Model</ThreeProvider>);
    view.rerender(<ThreeProvider graphicsBackend='webgpu'>Model</ThreeProvider>);
    expect(screen.getByLabelText('webgpu canvas')).toHaveTextContent('Model');
  });

  it('should preserve ordinary rendering errors instead of silently changing the backend', () => {
    allocation.error = new Error('Broken scene data');
    render(
      <WebglErrorBoundary fallback={({ error }) => <div role='alert'>{error?.message}</div>}>
        <ThreeProvider graphicsBackend='webgpu'>Model</ThreeProvider>
      </WebglErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Broken scene data');
    expect(screen.queryByLabelText('webgl canvas')).not.toBeInTheDocument();
  });
});
