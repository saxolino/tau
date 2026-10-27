import { describe, expect, it } from 'vitest';
import { stripBasename } from '#lib/base-path.js';

describe('stripBasename', () => {
  it.each([
    ['/cad/w/home/gear?chat=1#x', '/cad', '/w/home/gear?chat=1#x'],
    ['/cad', '/cad', '/'],
    ['/cad?x=1', '/cad', '/?x=1'],
    ['/cadastro', '/cad', '/cadastro'],
    ['/w/home/gear', '/cad', '/w/home/gear'],
    ['/w/home/gear', '', '/w/home/gear'],
    ['/w/home/gear', '/', '/w/home/gear'],
  ])('should turn %s under %s into %s', (path, basename, expected) => {
    expect(stripBasename(path, basename)).toBe(expected);
  });
});
