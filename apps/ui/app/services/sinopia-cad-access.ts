import { sinopiaSession } from '#lib/sinopia-session.js';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
import { readSinopiaCadLink } from '#services/sinopia-cad.js';
import type { SinopiaCadRecordFiles } from '#services/sinopia-cad.js';

/** Local listings use the same admitted account boundary as remote rows. */
export function sinopiaProjectListingKey(): readonly unknown[] {
  const session = sinopiaSession().getState();
  return session.status === 'disabled'
    ? ['projects']
    : ['projects', 'sinopia', session.status === 'signed-in' ? session.user.id : null];
}

/** A foreign or damaged ownership record fails closed without deleting the previous account's bytes. */
export async function canReadSinopiaCadProject(
  files: Pick<SinopiaCadRecordFiles, 'readFile' | 'exists'>,
  projectId: string,
  expectedUserId?: string,
): Promise<boolean> {
  const session = sinopiaSession().getState();
  if (session.status === 'disabled') {
    return true;
  }
  if (session.status !== 'signed-in' || (expectedUserId !== undefined && session.user.id !== expectedUserId)) {
    return false;
  }
  try {
    const link = await readSinopiaCadLink(files, `/projects/${projectId}`);
    await requireSinopiaUser(session.user.id);
    return link === undefined || link.userId === session.user.id;
  } catch {
    return false;
  }
}
