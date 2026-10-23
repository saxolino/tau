import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCadViewport } from '#hooks/use-cad-viewport.js';

describe('useCadViewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [320, 'phone'],
    [743, 'phone'],
    [744, 'tablet'],
    [768, 'tablet'],
    [900, 'tablet'],
    [1024, 'tablet'],
    [1366, 'tablet'],
    [1367, 'desktop'],
  ])('should choose the CAD layout at %i pixels', (width, expected) => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: width <= (query.includes('743') ? 743 : 1366),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { result } = renderHook(() => useCadViewport());
    expect(result.current).toBe(expected);
  });

  it('should update on rotation and release both media subscriptions on unmount', () => {
    let width = 744;
    const listeners = new Set<() => void>();
    const remove = vi.fn((_: string, listener: () => void) => {
      listeners.delete(listener);
    });
    vi.stubGlobal('matchMedia', (query: string) => ({
      get matches() {
        return width <= (query.includes('743') ? 743 : 1366);
      },
      addEventListener: (_: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: remove,
    }));
    const { result, unmount } = renderHook(() => useCadViewport());
    expect(result.current).toBe('tablet');
    act(() => {
      width = 1400;
      for (const listener of listeners) {
        listener();
      }
    });
    expect(result.current).toBe('desktop');
    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(listeners.size).toBe(0);
  });
});
