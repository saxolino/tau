import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../spikes/native-deps/linux/annotate.sh');

const annotate = (text: string | undefined, title = 'S14'): string => {
  const directory = mkdtempSync(join(tmpdir(), 'tau-spike-annotations-'));
  try {
    const file = join(directory, 'summary.txt');
    if (text !== undefined) {
      writeFileSync(file, text);
    }
    // The macOS split command has no -C option. Refuse every split invocation so this regression
    // cannot accidentally pass just because the test host has GNU coreutils.
    writeFileSync(join(directory, 'split'), '#!/bin/sh\nexit 64\n', { mode: 0o755 });
    const environment = { ...process.env };
    environment['PATH'] = `${directory}:${process.env['PATH'] ?? ''}`;
    const result = spawnSync('bash', [script, title, file], {
      encoding: 'utf8',
      env: environment,
      timeout: 5000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const noticeBodies = (output: string): string[] =>
  output
    .split('\n')
    .filter((line) => line.startsWith('::notice '))
    .map((line) => line.slice(line.indexOf('::', 2) + 2))
    .map((body) => body.replaceAll('%0D', '\r').replaceAll('%0A', '\n').replaceAll('%25', '%'));

describe('spike annotations', () => {
  it('should emit the exact summary without a GNU split dependency', () => {
    const text = '50 blobs\nverified: 100%\r\nsecond line';
    expect(noticeBodies(annotate(text))).toEqual([text]);
  });

  it('should preserve Unicode across bounded notice chunks', () => {
    const text = 'λ🙂'.repeat(1500);
    const bodies = noticeBodies(annotate(text));
    expect(bodies.join('')).toBe(text);
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.every((body) => Buffer.byteLength(body) <= 3800)).toBe(true);
  });

  it('should cap output at nine notices and report truncation', () => {
    const output = annotate('x'.repeat(3800 * 10));
    expect(noticeBodies(output)).toHaveLength(9);
    expect(noticeBodies(output).join('')).toBe('x'.repeat(3800 * 9));
    expect(output).toContain('::warning title=S14::summary truncated after 9 notices');
  });

  it('should escape annotation properties and command-looking summary lines', () => {
    const output = annotate('result\n::error::not a command', 'S14,:\nunsafe');
    expect(output).toContain('title=S14%2C%3A%0Aunsafe (1)::result%0A::error::not a command');
    expect(output.trim().split('\n')).toHaveLength(1);
  });

  it('should handle missing and empty summaries without a false result', () => {
    expect(annotate(undefined)).toContain('::warning title=S14::no summary file ');
    expect(annotate('')).toBe('');
  });
});
