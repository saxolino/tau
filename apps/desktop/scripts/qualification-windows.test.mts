#!/usr/bin/env node
/** Purpose: Exercise Windows driver execution guards and real artifact-byte admission without granting installer authority. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDesktopArtifactManifest } from '#shared/desktop-release.js';
/* oxlint-disable no-restricted-imports -- Native driver admission tests use actual fixture bytes. */
import { createWindowsQualificationDriver, verifyWindowsQualificationArtifact } from './qualification-windows.mjs';
import { QualificationUnavailable } from './qualification-platform-types.mjs';
/* oxlint-enable no-restricted-imports */
const main = async (): Promise<void> => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tau-windows-admission-')));
  const originalGuard = process.env['TAU_QUALIFICATION_DISPOSABLE_HOST'];
  delete process.env['TAU_QUALIFICATION_DISPOSABLE_HOST'];
  try {
    assert.throws(
      () => createWindowsQualificationDriver({ mode: 'fixture', installationPath: join(root, 'installed') }),
      QualificationUnavailable,
    );
    const bytes = Buffer.from('explicit inert fixture, never executed');
    const name = 'Tau-win32-x64.exe';
    const path = join(root, name);
    await writeFile(path, bytes);
    const manifest = parseDesktopArtifactManifest({
      schemaVersion: 1,
      tag: 'desktop-staging@0.1.0-staging.1',
      channel: 'staging',
      version: '1.0.1',
      sourceCommit: 'a'.repeat(40),
      artifacts: [
        {
          target: 'win32-x64',
          kind: 'windows-nsis',
          name,
          format: 'exe',
          roles: ['installer', 'update'],
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sha512: createHash('sha512').update(bytes).digest('base64'),
        },
      ],
    });
    const candidate = { manifest, artifactDirectory: root, route: 'windows-nsis' } as const;
    assert.equal(await verifyWindowsQualificationArtifact(candidate), path);
    await writeFile(path, Buffer.alloc(bytes.length, 1));
    await assert.rejects(verifyWindowsQualificationArtifact(candidate), /bytes differ/u);
    await writeFile(path, bytes.subarray(1));
    await assert.rejects(verifyWindowsQualificationArtifact(candidate), /bytes differ/u);
    await assert.rejects(
      verifyWindowsQualificationArtifact({ ...candidate, route: 'linux-appimage' }),
      /Wrong Windows/u,
    );
    if (process.platform !== 'win32') {
      const target = join(root, 'elsewhere');
      await writeFile(target, bytes);
      await rm(path);
      await symlink(target, path);
      await assert.rejects(verifyWindowsQualificationArtifact(candidate), /canonical regular/u);
    }
    console.log(
      'PASS Windows driver guard and real installer-byte tamper/route/path refusal; native install/security execution remains a separate qualification',
    );
  } finally {
    if (originalGuard === undefined) {
      delete process.env['TAU_QUALIFICATION_DISPOSABLE_HOST'];
    } else {
      process.env['TAU_QUALIFICATION_DISPOSABLE_HOST'] = originalGuard;
    }
    await rm(root, { recursive: true, force: true });
  }
};
try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
