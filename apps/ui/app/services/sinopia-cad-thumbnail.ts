import { z } from 'zod';
import { Topic } from '@taucad/events';
import { sha256Bytes } from '@taucad/utils/hash';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
import type { SinopiaCadRecordFiles } from '#services/sinopia-cad.js';

/** Captured before rendering, then checked again before publication. */
export const sinopiaCadCaptureStampSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  revisionId: z.string(),
  checkoutId: z.string(),
  checkoutRoot: z.string(),
});
export type SinopiaCadCaptureStamp = z.infer<typeof sinopiaCadCaptureStampSchema>;
const thumbnailRecordSchema = sinopiaCadCaptureStampSchema.extend({ digest: z.string() });
export const sinopiaCadThumbnailReady = new Topic<SinopiaCadCaptureStamp>({ name: 'SinopiaCad.thumbnailReady' });
export const sinopiaCadThumbnailRequested = new Topic<SinopiaCadCaptureStamp>({
  name: 'SinopiaCad.thumbnailRequested',
});

/** Equality includes account, checkout and immutable revision; a clean current head alone is insufficient. */
export function sameSinopiaCapture(
  left: SinopiaCadCaptureStamp | undefined,
  right: SinopiaCadCaptureStamp | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  return (
    left.userId === right.userId &&
    left.projectId === right.projectId &&
    left.revisionId === right.revisionId &&
    left.checkoutId === right.checkoutId &&
    left.checkoutRoot === right.checkoutRoot
  );
}

/** Bind the existing thumbnail bytes to their actual capture identity; hashing detects a later thumbnail replacing them. */
export async function persistSinopiaCadThumbnail(
  files: Pick<SinopiaCadRecordFiles, 'writeFile'>,
  stamp: SinopiaCadCaptureStamp,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<void> {
  await requireSinopiaUser(stamp.userId);
  const digest = await sha256Bytes(bytes);
  await requireSinopiaUser(stamp.userId);
  await files.writeFile(`${stamp.checkoutRoot}/.tau/sinopia-thumbnail.json`, JSON.stringify({ ...stamp, digest }));
  sinopiaCadThumbnailReady.emit(stamp);
}

/** Never reuse an unstamped thumbnail from the previous revision or another checkout/account. */
export async function readSinopiaCadThumbnail(
  files: Pick<SinopiaCadRecordFiles, 'readFile' | 'exists'>,
  stamp: SinopiaCadCaptureStamp,
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  await requireSinopiaUser(stamp.userId);
  const recordPath = `${stamp.checkoutRoot}/.tau/sinopia-thumbnail.json`;
  const imagePath = `${stamp.checkoutRoot}/thumbnail.webp`;
  if (!(await files.exists(recordPath)) || !(await files.exists(imagePath))) {
    return undefined;
  }
  const record = thumbnailRecordSchema.safeParse(
    JSON.parse(new TextDecoder().decode(await files.readFile(recordPath))),
  );
  if (!record.success || !sameSinopiaCapture(record.data, stamp)) {
    return undefined;
  }
  const bytes = await files.readFile(imagePath);
  const digest = await sha256Bytes(bytes);
  await requireSinopiaUser(stamp.userId);
  return digest === record.data.digest ? bytes : undefined;
}
