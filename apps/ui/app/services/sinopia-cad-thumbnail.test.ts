// @vitest-environment node
import { mock } from 'vitest-mock-extended';
import { describe, expect, it, vi } from 'vitest';
import type { SinopiaCadRecordFiles } from '#services/sinopia-cad.js';
import {
  persistSinopiaCadThumbnail,
  readSinopiaCadThumbnail,
  sameSinopiaCapture,
} from '#services/sinopia-cad-thumbnail.js';
import type { SinopiaCadCaptureStamp } from '#services/sinopia-cad-thumbnail.js';
vi.mock('#lib/sinopia-data-client.js', () => ({ requireSinopiaUser: async () => undefined }));
const stamp: SinopiaCadCaptureStamp = {
  projectId: 'local',
  userId: 'one',
  revisionId: 'a'.repeat(40),
  checkoutId: 'checkout',
  checkoutRoot: '/projects/local',
};
const create = () => {
  const records = new Map<string, Uint8Array<ArrayBuffer>>();
  const files = mock<SinopiaCadRecordFiles>({
    exists: async (path) => records.has(path),
    readFile: async (path) => {
      const bytes = records.get(path);
      if (bytes === undefined) {
        throw new Error('missing');
      }
      return bytes;
    },
    writeFile: async (path, content) => {
      records.set(path, typeof content === 'string' ? new TextEncoder().encode(content) : content);
    },
  });
  return { records, files };
};
describe('revision-proven thumbnail', () => {
  it('requires persisted capture identity and matching image digest', async () => {
    const owner = create();
    const bytes = new Uint8Array([1, 2]);
    owner.records.set(`${stamp.checkoutRoot}/thumbnail.webp`, bytes);
    expect(await readSinopiaCadThumbnail(owner.files, stamp)).toBeUndefined();
    await persistSinopiaCadThumbnail(owner.files, stamp, bytes);
    expect(await readSinopiaCadThumbnail(owner.files, stamp)).toEqual(bytes);
    owner.records.set(`${stamp.checkoutRoot}/thumbnail.webp`, new Uint8Array([9]));
    expect(await readSinopiaCadThumbnail(owner.files, stamp)).toBeUndefined();
  });
  it('never attaches the previous revision or checkout preview to the new snapshot', async () => {
    const owner = create();
    const bytes = new Uint8Array([1]);
    owner.records.set(`${stamp.checkoutRoot}/thumbnail.webp`, bytes);
    await persistSinopiaCadThumbnail(owner.files, stamp, bytes);
    expect(await readSinopiaCadThumbnail(owner.files, { ...stamp, revisionId: 'b'.repeat(40) })).toBeUndefined();
    expect(await readSinopiaCadThumbnail(owner.files, { ...stamp, checkoutId: 'other' })).toBeUndefined();
  });
  it('keeps account and project identity inside the capture boundary', () => {
    expect(sameSinopiaCapture(stamp, { ...stamp, userId: 'two' })).toBe(false);
    expect(sameSinopiaCapture(stamp, { ...stamp, projectId: 'other' })).toBe(false);
    expect(sameSinopiaCapture(undefined, undefined)).toBe(false);
  });
});
