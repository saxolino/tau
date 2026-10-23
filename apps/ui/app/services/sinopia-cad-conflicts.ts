import { Topic } from '@taucad/events';
import { requireSinopiaUser } from '#lib/sinopia-data-client.js';
import { sinopiaCadModelSchema } from '#services/sinopia-cad.js';
import type { SinopiaCadModel, SinopiaCadRecordFiles } from '#services/sinopia-cad.js';

export const sinopiaConflictTopic = new Topic<string>({ name: 'SinopiaCad.conflicts' });
const rootOf = (projectId: string): string => `/projects/${projectId}/.tau/sinopia-conflicts`;

/** Preserve the losing remote snapshot's immutable object references before deciding either way. */
export async function preserveSinopiaConflict(
  files: Pick<SinopiaCadRecordFiles, 'writeFile'>,
  projectId: string,
  model: SinopiaCadModel,
): Promise<void> {
  await requireSinopiaUser(model.user_id);
  if (model.snapshot_path === null || model.head_revision_id === null) {
    return;
  }
  await files.writeFile(
    `${rootOf(projectId)}/${model.head_revision_id}.json`,
    JSON.stringify(sinopiaCadModelSchema.parse(model)),
  );
  sinopiaConflictTopic.emit(projectId);
}

/** The real Versions panel reads the retained copies for this account only. */
export async function readSinopiaConflicts(
  files: Pick<SinopiaCadRecordFiles, 'exists' | 'readdir' | 'readFile'>,
  projectId: string,
  userId: string,
): Promise<readonly SinopiaCadModel[]> {
  await requireSinopiaUser(userId);
  const root = rootOf(projectId);
  if (!(await files.exists(root))) {
    return [];
  }
  const entries = await files.readdir(root);
  const models = await Promise.all(
    entries
      .filter((name) => /^[0-9a-f]{40}(?:[0-9a-f]{24})?\.json$/u.test(name))
      .map(async (name) =>
        sinopiaCadModelSchema.parse(JSON.parse(new TextDecoder().decode(await files.readFile(`${root}/${name}`)))),
      ),
  );
  await requireSinopiaUser(userId);
  return models
    .filter((model) => model.user_id === userId)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}
