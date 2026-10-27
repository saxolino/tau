import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assistantDockDragDirection,
  defaultAssistantDockPosition,
  readAssistantDockPosition,
  stepAssistantDockPosition,
  writeAssistantDockPosition,
} from '#lib/assistant-dock-position.js';

describe('assistant dock position', () => {
  afterEach(() => {
    globalThis.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should remember the height per project and fall back to the default', () => {
    expect(readAssistantDockPosition('p1')).toBe(defaultAssistantDockPosition);
    writeAssistantDockPosition('p1', 'line');
    writeAssistantDockPosition('p2', 'tall');
    expect(readAssistantDockPosition('p1')).toBe('line');
    expect(readAssistantDockPosition('p2')).toBe('tall');
    expect(readAssistantDockPosition('p3')).toBe('open');
  });

  it('should ignore a stored value that is not a height', () => {
    globalThis.localStorage.setItem('sinopiacad.assistant-dock.p1', 'huge');
    expect(readAssistantDockPosition('p1')).toBe('open');
  });

  it('should survive a blocked store', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      writeAssistantDockPosition('p1', 'line');
    }).not.toThrow();
    expect(readAssistantDockPosition('p1')).toBe('open');
  });

  it('should step between line, open and tall without leaving the ends', () => {
    expect(stepAssistantDockPosition('line', 'up')).toBe('open');
    expect(stepAssistantDockPosition('open', 'up')).toBe('tall');
    expect(stepAssistantDockPosition('tall', 'up')).toBe('tall');
    expect(stepAssistantDockPosition('tall', 'down')).toBe('open');
    expect(stepAssistantDockPosition('open', 'down')).toBe('line');
    expect(stepAssistantDockPosition('line', 'down')).toBe('line');
  });

  it('should read a drag of the line as up, down or nothing', () => {
    expect(assistantDockDragDirection(-40)).toBe('up');
    expect(assistantDockDragDirection(40)).toBe('down');
    expect(assistantDockDragDirection(-10)).toBeUndefined();
    expect(assistantDockDragDirection(0)).toBeUndefined();
  });
});
