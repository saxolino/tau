/* oxlint-disable typescript/no-restricted-types -- Supabase nullable heads and paths are part of its wire contract. */
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { classify } from '@taucad/filesystem/path-registry';
import { archive, archiveByteCeiling } from '@taucad/filesystem/content-ops';
import { MemoryProvider } from '@taucad/filesystem/backend';
import { projectToManifest, readProjectManifestBytes, serializeProjectManifest } from '@taucad/types';
import type { ProjectManifest } from '@taucad/types';
import { base64ToUint8Array, uint8ArrayToHex } from 'uint8array-extras';
import { KeyedMutex } from '#db/keyed-mutex.js';
import { getSinopiaDataClient, requireSinopiaUser } from '#lib/sinopia-data-client.js';
import type { RootedContentClient } from '@taucad/fs-client/rooted-content-client';
import { randomUuid } from '@taucad/utils/id';
import { sha256Bytes, sha256String } from '@taucad/utils/hash';
import { defaultProjectName, isPlaceholderProjectName, projectNameOrDefault } from '#constants/project-names.js';
export type SinopiaCadRecordFiles = Pick<RootedContentClient, 'writeFile' | 'exists' | 'readdir'> & {
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
};

export const sinopiaCadLinkPath = '.tau/sinopia.json';
const revisionSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
/** The id `riconosci-parti` gives a part (snake_case), as `/cad/nuovo?part=` carries it. */
const partIdSchema = z.string().regex(/^[\d_a-z]{1,200}$/u);
export const sinopiaCadLinkSchema = z.object({
  modelId: z.uuid(),
  projectId: z.uuid(),
  userId: z.uuid(),
  baseRevisionId: revisionSchema.nullable(),
  localRevisionId: revisionSchema.optional(),
  /**
   * The content (`sinopiaCadContentKey`) of the copy on Sinopia this device knows as `baseRevisionId`. Every device
   * mints its own commit for the same files, so the ids differ where the content does not: a model opened from Sinopia
   * on another computer is the same model, not a change to save again.
   */
  baseContentKey: z
    .string()
    .regex(/^[0-9a-f]{64}$/u)
    .optional(),
  previewPending: z.boolean().optional(),
  /** The project's image (`assets.id`) the model was built from: Sinopia shows it as the model's origin. */
  sourceAssetId: z.uuid().optional(),
  /** The part of that image (`riconosci-parti` id), so «Apri nel CAD» on the same part reopens this model. */
  sourcePartId: partIdSchema.optional(),
  /**
   * The CAD created this Sinopia project for the model (nobody chose a project): only then may the model's name
   * replace the project's default «Nuovo progetto». A project the person started from is never renamed.
   */
  projectCreatedByCad: z.boolean().optional(),
});
/** The local baseline is a record, excluded from authored archives and revision creation. */
export type SinopiaCadLink = z.infer<typeof sinopiaCadLinkSchema>;
export type SinopiaCadEngine = 'smlib' | 'picovoxel' | 'replicad' | 'manifold';
/* eslint-disable @typescript-eslint/naming-convention -- Supabase model columns keep their wire names. */
export const sinopiaCadModelSchema = z.object({
  id: z.uuid(),
  project_id: z.uuid(),
  user_id: z.uuid(),
  name: z.string(),
  engine: z.enum(['smlib', 'picovoxel', 'replicad', 'manifold']),
  head_revision_id: revisionSchema.nullable(),
  snapshot_path: z.string().nullable(),
  thumbnail_path: z.string().nullable(),
  snapshot_bytes: z.number().nullable(),
  updated_at: z.string(),
});
/* eslint-enable @typescript-eslint/naming-convention -- Application-owned names remain camelCase. */
export type SinopiaCadModel = z.infer<typeof sinopiaCadModelSchema>;
export type SinopiaCadFiles = Record<string, { content: Uint8Array<ArrayBuffer>; mode?: '100644' | '100755' }>;
const columns =
  'id,project_id,user_id,name,engine,head_revision_id,snapshot_path,thumbnail_path,snapshot_bytes,updated_at';
/** Postgres `unique_violation`, as PostgREST reports a second insert of the same primary key. */
const uniqueViolation = '23505';
/**
 * The origin columns (`source_asset_id`, `source_part_id`) arrive with a migration Marko applies by hand. Until then a
 * select naming them answers 42703 (undefined column) and a write PGRST204 (not in the schema cache): both mean «not
 * yet», and the CAD carries on without the origin instead of failing.
 */
const isMissingOriginColumn = (error: { code?: string; message?: string }): boolean =>
  (error.code === '42703' || error.code === 'PGRST204') && /source_(?:asset|part)_id/u.test(error.message ?? '');
const linkLocks = new KeyedMutex<string>();

/** One link creation per local project across this origin's tabs; an in-document queue without the Locks API. */
async function withLinkLock<T>(localProjectId: string, task: () => Promise<T>): Promise<T> {
  const name = `sinopia-cad-link:${localProjectId}`;
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks === undefined ? linkLocks.run(name, task) : locks.request(name, task);
}

/** Never turn malformed or foreign link bytes into a new model. */
export async function readSinopiaCadLink(
  files: Pick<SinopiaCadRecordFiles, 'readFile' | 'exists'>,
  root: string,
): Promise<SinopiaCadLink | undefined> {
  const path = `${root.replace(/\/$/u, '')}/${sinopiaCadLinkPath}`;
  if (!(await files.exists(path))) {
    return undefined;
  }
  return sinopiaCadLinkSchema.parse(JSON.parse(new TextDecoder().decode(await files.readFile(path))));
}

/** Record writes always use the protected working-copy record authority. */
export async function writeSinopiaCadLink(
  files: Pick<SinopiaCadRecordFiles, 'writeFile'>,
  root: string,
  link: SinopiaCadLink,
): Promise<void> {
  await requireSinopiaUser(link.userId);
  await files.writeFile(
    `${root.replace(/\/$/u, '')}/${sinopiaCadLinkPath}`,
    JSON.stringify(sinopiaCadLinkSchema.parse(link)),
  );
}

/** Source imports reveal the actual generated engine, independently of the starter template or UI preference. */
export function inferSinopiaCadEngine(source: string): SinopiaCadEngine | undefined {
  if (/['"]@classcad\/smlibwasm['"]/u.test(source)) {
    return 'smlib';
  }
  const engines: SinopiaCadEngine[] = ['smlib', 'picovoxel', 'replicad', 'manifold'];
  return engines.find((engine) =>
    new RegExp(
      `(?:from\\s*|import\\s*\\(|require\\s*\\()['"](?:@taucad/|@taulabs/)?${engine}(?:/[^'"]*)?['"]`,
      'u',
    ).test(source),
  );
}

/** The Sinopia project verticals (`projects_vertical_check`) a CAD-born project may take. */
const sinopiaVerticals = new Set(['footwear', 'leather_goods', 'atelier', 'accessories']);

/**
 * The vertical the person is working in on Sinopia (`profiles.current_vertical`): a heel is born in a footwear
 * project. Falls back to accessories, SinopiaCAD's own trade, when the profile has none or cannot be read.
 */
async function currentSinopiaVertical(client: SupabaseClient, userId: string): Promise<string> {
  try {
    const { data, error } = await client.from('profiles').select('current_vertical').eq('id', userId).maybeSingle();
    if (error === null) {
      const vertical: unknown = (data as { current_vertical?: unknown } | null)?.current_vertical;
      if (typeof vertical === 'string' && sinopiaVerticals.has(vertical)) {
        return vertical;
      }
    }
  } catch {
    /* Falls back below: the vertical is a convenience, never a reason to lose the model. */
  }
  return 'accessories';
}

/** Where in a Sinopia project a model starts: one image of the project and, when known, one part of it. */
export type SinopiaCadSource = Readonly<{ assetId: string; partId?: string }>;

/**
 * Mint a recoverable local identity first; the chosen engine registers its model on the first authored save.
 *
 * With `originProjectId` the model belongs to that (owned) Sinopia project: no second project is ever created for a
 * piece that starts from a Sinopia part, image or generation. Without it the model gets a project of its own, but only
 * its identity is fixed here: the project is created by the model's first real save (`ensureSinopiaCadModel`), named
 * after the piece, so a model that never saves anything leaves no empty project in the dashboard.
 */
export async function createSinopiaCadLink(
  name: string,
  originProjectId?: string,
  named?: Readonly<{ projectId: string; modelId: string }>,
): Promise<SinopiaCadLink> {
  const { client, userId } = await getSinopiaDataClient();
  const modelId = named?.modelId ?? randomUuid();
  if (originProjectId === undefined) {
    await requireSinopiaUser(userId);
    // The CAD's own project, still to be created: `projectCreatedByCad` is what tells the first save to create it.
    return {
      modelId,
      projectId: named?.projectId ?? randomUuid(),
      userId,
      baseRevisionId: null,
      projectCreatedByCad: true,
    };
  }
  const projectId = z.uuid().parse(originProjectId);
  const { data, error } = await client
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .single();
  if (error !== null) {
    throw error;
  }
  z.object({ id: z.uuid() }).parse(data);
  await requireSinopiaUser(userId);
  return { modelId, projectId, userId, baseRevisionId: null };
}

/**
 * The project the CAD made for a model (`projectCreatedByCad`), created now: by the first save that has something to
 * keep, never when the link is minted. Its id was fixed with the link, so a retry, another tab or a lost acknowledgement
 * land on the same project; one that already exists must be this account's and alive.
 */
async function ensureCadOwnProject(client: SupabaseClient, link: SinopiaCadLink, name: string): Promise<void> {
  if (link.projectCreatedByCad !== true) {
    return;
  }
  const vertical = await currentSinopiaVertical(client, link.userId);
  await requireSinopiaUser(link.userId);
  const { error } = await client
    .from('projects')
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase project wire columns.
    .insert({ id: link.projectId, user_id: link.userId, name: projectNameOrDefault(name), vertical });
  if (error === null) {
    return;
  }
  if (error.code !== uniqueViolation) {
    throw error;
  }
  const owned = await client
    .from('projects')
    .select('id')
    .eq('id', link.projectId)
    .eq('user_id', link.userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (owned.error !== null) {
    throw owned.error;
  }
  if (owned.data === null) {
    throw new Error('SINOPIA_PROJECT_UNAVAILABLE');
  }
}

/**
 * The link with the image (and part) of its project the model starts from; a malformed origin is left out.
 *
 * @param link - A link to an existing Sinopia project (the origin only means something inside it).
 * @param source - The image and part, from `/cad/nuovo`.
 * @returns The link carrying the origin.
 */
export function withSinopiaCadSource(link: SinopiaCadLink, source: SinopiaCadSource | undefined): SinopiaCadLink {
  if (source === undefined || !z.uuid().safeParse(source.assetId).success) {
    return link;
  }
  return {
    ...link,
    sourceAssetId: source.assetId.toLowerCase(),
    ...(source.partId !== undefined && partIdSchema.safeParse(source.partId).success
      ? { sourcePartId: source.partId }
      : {}),
  };
}

/**
 * Name-based RFC 9562 version 8 identities (SHA-256): one Sinopia project and one model per account and local
 * project, whichever tab, remount or retry asks for them.
 */
export async function sinopiaCadLinkIds(
  userId: string,
  localProjectId: string,
): Promise<{ projectId: string; modelId: string }> {
  const derive = async (kind: 'project' | 'model'): Promise<string> => {
    const hex = uint8ArrayToHex(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(`sinopiacad:${kind}:${userId}:${localProjectId}`),
        ),
      ),
    );
    // Version nibble 8; the variant nibble keeps two hash bits under the RFC's leading `10`.
    const variant = (8 + (Number.parseInt(hex[16]!, 16) % 4)).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  };
  return { projectId: await derive('project'), modelId: await derive('model') };
}

/**
 * Link a model made before the Sinopia link existed through the creation path new models use. Under one lock per
 * local project the persisted link is read again, so another tab's or an earlier attempt's link always wins; the
 * named identities make a lost write or a race converge on the same Sinopia project instead of a second one. The
 * model's `cad_models` row follows on its first authored save, as for a new model.
 */
export async function linkSinopiaCadModel(input: {
  files: Pick<SinopiaCadRecordFiles, 'readFile' | 'exists' | 'writeFile'>;
  localProjectId: string;
  userId: string;
  name: string;
}): Promise<SinopiaCadLink> {
  const root = `/projects/${input.localProjectId}`;
  return withLinkLock(input.localProjectId, async () => {
    await requireSinopiaUser(input.userId);
    const existing = await readSinopiaCadLink(input.files, root);
    if (existing !== undefined) {
      if (existing.userId !== input.userId) {
        throw new Error('SINOPIA_OWNER_MISMATCH');
      }
      return existing;
    }
    const ids = await sinopiaCadLinkIds(input.userId, input.localProjectId);
    const link = await createSinopiaCadLink(input.name, undefined, ids);
    if (link.userId !== input.userId) {
      throw new Error('SINOPIA_OWNER_MISMATCH');
    }
    await writeSinopiaCadLink(input.files, root, link);
    return link;
  });
}

/** Owner filters remain explicit even where an admin's database policies permit broader reads. */
export async function listSinopiaCadModels(): Promise<readonly SinopiaCadModel[]> {
  const { client, userId } = await getSinopiaDataClient();
  const { data, error } = await client
    .from('cad_models')
    .select(columns)
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error !== null) {
    throw error;
  }
  const rows = z.array(sinopiaCadModelSchema).parse(data);
  await requireSinopiaUser(userId);
  return rows.filter((row) => row.user_id === userId);
}

/**
 * The part this link starts from is already another model of the account (the unique index on the origin answered
 * 23505: two «Apri nel CAD» of the same part, on two devices or two tabs, before either saved). The model to keep
 * working on is that one: `adopted` is the link that points at it, with no baseline, so the next save asks which
 * version to keep instead of making a second model of the same part.
 */
export class SinopiaCadOriginTakenError extends Error {
  public readonly adopted: SinopiaCadLink;
  public constructor(adopted: SinopiaCadLink) {
    super('SINOPIA_ORIGIN_TAKEN');
    this.name = 'SinopiaCadOriginTakenError';
    this.adopted = adopted;
  }
}

/**
 * Before a row is registered: a row of this id that is gone (deleted on Sinopia) or lives in another project (moved by
 * another device) must not come back as a new row, nor recreate the project it left.
 */
async function assertModelNotGone(client: SupabaseClient, link: SinopiaCadLink): Promise<void> {
  const { data, error } = await client
    .from('cad_models')
    .select('id,project_id,deleted_at')
    .eq('id', link.modelId)
    .eq('user_id', link.userId)
    .maybeSingle();
  if (error !== null) {
    throw error;
  }
  const row = z
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase model wire columns.
    .object({ id: z.uuid(), project_id: z.uuid(), deleted_at: z.string().nullable() })
    .nullable()
    .parse(data);
  if (row?.deleted_at !== null && row?.deleted_at !== undefined) {
    throw new Error('SINOPIA_MODEL_DELETED');
  }
  if (row !== null && row.project_id !== link.projectId) {
    throw new Error('SINOPIA_MODEL_MOVED');
  }
}

/** Read or register exactly the linked model, never a second identity on retry. */
export async function ensureSinopiaCadModel(
  link: SinopiaCadLink,
  name: string,
  engine: SinopiaCadEngine,
): Promise<SinopiaCadModel> {
  const existing = await getSinopiaCadModel(link);
  if (existing !== undefined) {
    return existing;
  }
  const { client } = await getSinopiaDataClient();
  await requireSinopiaUser(link.userId);
  await assertModelNotGone(client, link);
  await ensureCadOwnProject(client, link, name);
  await requireSinopiaUser(link.userId);
  /* eslint-disable @typescript-eslint/naming-convention -- Supabase model wire columns. */
  const row = {
    id: link.modelId,
    project_id: link.projectId,
    user_id: link.userId,
    name: projectNameOrDefault(name, 'Modello CAD'),
    engine,
  };
  const origin = {
    ...(link.sourceAssetId === undefined ? {} : { source_asset_id: link.sourceAssetId }),
    ...(link.sourcePartId === undefined ? {} : { source_part_id: link.sourcePartId }),
  };
  /* eslint-enable @typescript-eslint/naming-convention -- Back to the domain's camelCase names. */
  const options = { onConflict: 'id', ignoreDuplicates: true } as const;
  let { error } = await client.from('cad_models').upsert({ ...row, ...origin }, options);
  if (error !== null && Object.keys(origin).length > 0 && isMissingOriginColumn(error)) {
    ({ error } = await client.from('cad_models').upsert(row, options));
  }
  if (error !== null && error.code === uniqueViolation && link.sourceAssetId !== undefined) {
    // Find or create: the part already became a model (`cad_models_source_unico_idx`), that model is the one to use.
    const taken =
      link.sourcePartId === undefined
        ? undefined
        : await findSinopiaCadModelForPart({
            projectId: link.projectId,
            assetId: link.sourceAssetId,
            partId: link.sourcePartId,
          });
    if (taken !== undefined && taken.id !== link.modelId) {
      const { localRevisionId: _local, baseContentKey: _content, previewPending: _preview, ...rest } = link;
      throw new SinopiaCadOriginTakenError({ ...rest, modelId: taken.id, baseRevisionId: null });
    }
  }
  if (error !== null) {
    throw error;
  }
  const registered = await getSinopiaCadModel(link);
  if (registered === undefined) {
    // The insert was ignored: the id exists but is not an active row of this project any more.
    throw new Error('SINOPIA_MODEL_DELETED');
  }
  return registered;
}

/** Read one owned active row and validate its project as well as its account. */
export async function getSinopiaCadModel(link: SinopiaCadLink): Promise<SinopiaCadModel | undefined> {
  const { client } = await getSinopiaDataClient();
  await requireSinopiaUser(link.userId);
  const { data, error } = await client
    .from('cad_models')
    .select(columns)
    .eq('id', link.modelId)
    .eq('project_id', link.projectId)
    .eq('user_id', link.userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error !== null) {
    throw error;
  }
  await requireSinopiaUser(link.userId);
  if (data === null) {
    return undefined;
  }
  const row = sinopiaCadModelSchema.parse(data);
  if (row.user_id !== link.userId || row.project_id !== link.projectId) {
    throw new Error('SINOPIA_OWNER_MISMATCH');
  }
  return row;
}

/** Snapshot bytes come from the immutable recorded revision, through the existing filesystem archive owner. */
export async function archiveSinopiaRevision(snapshot: Readonly<Record<string, string>>): Promise<Blob> {
  const memory = new MemoryProvider();
  let bytes = 0;
  for (const [path, encoded] of Object.entries(snapshot)) {
    if (!safeAuthoredPath(path)) {
      continue;
    }
    const content = base64ToUint8Array(encoded);
    bytes += content.byteLength;
    if (bytes > archiveByteCeiling) {
      throw new Error('ARCHIVE_TOO_LARGE');
    }
    // oxlint-disable-next-line no-await-in-loop -- Bound memory and preserve one immutable file at a time.
    await memory.writeFile(path, content);
  }
  return archive(memory, '', { admits: (path, kind) => kind === 'dir' || classify(path).versioned });
}

/**
 * The content of a model as Sinopia keeps it: one SHA-256 over its authored, versioned files (sources, parameters,
 * manifest) by path, whatever revision, device or archive carried them. Records (`.tau/sinopia.json`, chats) do not
 * count. Two commits of the same files have the same key: this is the «same model?» question, never the revision id.
 *
 * @param files - Path → bytes.
 * @returns 64 lowercase hex digits.
 */
export async function sinopiaCadContentKey(files: Readonly<Record<string, Uint8Array<ArrayBuffer>>>): Promise<string> {
  const lines: string[] = [];
  for (const path of Object.keys(files)
    .filter((candidate) => safeAuthoredPath(candidate))
    .sort()) {
    // oxlint-disable-next-line no-await-in-loop -- One file digest at a time keeps memory to one file.
    lines.push(`${path}\u0000${await sha256Bytes(files[path]!)}`);
  }
  return sha256String(lines.join('\n'));
}

/** {@link sinopiaCadContentKey} of an immutable revision snapshot (path → base64), as the revision owner returns it. */
export async function sinopiaCadSnapshotContentKey(snapshot: Readonly<Record<string, string>>): Promise<string> {
  return sinopiaCadContentKey(
    Object.fromEntries(Object.entries(snapshot).map(([path, encoded]) => [path, base64ToUint8Array(encoded)])),
  );
}

function safeAuthoredPath(path: string): boolean {
  return (
    path !== '' &&
    path.length <= 4096 &&
    !/^[A-Za-z]:/u.test(path) &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').some((part) => part === '..' || part === '.' || part === '') &&
    classify(path).versioned
  );
}

function modelStoragePath(model: Pick<SinopiaCadModel, 'project_id' | 'id'>, path: string): string {
  const prefix = `projects/${model.project_id}/cad/${model.id}/`;
  if (
    !path.startsWith(prefix) ||
    path.includes('\\') ||
    path.includes('//') ||
    path.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw new Error('SINOPIA_INVALID_STORAGE_PATH');
  }
  return path;
}

/** Download only the immutable private object named by an owned model row. */
export async function downloadSinopiaCadObject(model: SinopiaCadModel, path: string): Promise<Blob> {
  const { client } = await getSinopiaDataClient();
  await requireSinopiaUser(model.user_id);
  const { data, error } = await client.storage.from('creator-private').download(modelStoragePath(model, path));
  if (error !== null) {
    throw error;
  }
  await requireSinopiaUser(model.user_id);
  return data;
}

/** Validate the complete ZIP before any local mutation; records and traversal never enter through remote bytes. */
export async function importSinopiaCadModel(
  model: SinopiaCadModel,
): Promise<{ project: Omit<ProjectManifest, '$schema'>; files: SinopiaCadFiles; link: SinopiaCadLink }> {
  if (model.snapshot_path === null) {
    throw new Error('SINOPIA_MODEL_NOT_SAVED');
  }
  const blob = await downloadSinopiaCadObject(model, model.snapshot_path);
  if (blob.size > archiveByteCeiling) {
    throw new Error('ARCHIVE_TOO_LARGE');
  }
  const { default: zipLibrary } = await import('jszip');
  const zip = await zipLibrary.loadAsync(await blob.arrayBuffer());
  const files: SinopiaCadFiles = {};
  let total = 0;
  const entries: Array<
    (typeof zip.files)[string] & {
      readonly _data?: { readonly uncompressedSize?: number; readonly compressedSize?: number };
    }
  > = Object.values(zip.files);
  const names = new Set<string>();
  let declaredBytes = 0;
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    if (names.has(name)) {
      throw new Error('SINOPIA_INVALID_ARCHIVE');
    }
    names.add(name);
    const permissions =
      typeof entry.unixPermissions === 'string' ? Number.parseInt(entry.unixPermissions, 8) : entry.unixPermissions;
    if (permissions !== null && Math.floor(permissions / 4096) % 16 === 10) {
      throw new Error('SINOPIA_INVALID_ARCHIVE');
    }
    const size = entry._data?.uncompressedSize ?? 0;
    declaredBytes += size;
    if (
      declaredBytes > archiveByteCeiling ||
      size > 64 * 1024 * 1024 ||
      size / Math.max(1, entry._data?.compressedSize ?? size) > 1000
    ) {
      throw new Error('ARCHIVE_TOO_LARGE');
    }
  }
  if (entries.length > 10_000) {
    throw new Error('ARCHIVE_TOO_LARGE');
  }
  for (const file of entries) {
    const original = file.unsafeOriginalName ?? file.name;
    if (file.dir) {
      continue;
    }
    if (original !== file.name || !safeAuthoredPath(file.name)) {
      throw new Error('SINOPIA_INVALID_ARCHIVE');
    }
    // oxlint-disable-next-line no-await-in-loop -- Validate expanded bytes against the archive ceiling before accepting another file.
    const content = new Uint8Array(await file.async('uint8array'));
    total += content.byteLength;
    if (total > archiveByteCeiling) {
      throw new Error('ARCHIVE_TOO_LARGE');
    }
    files[file.name] = { content };
  }
  const manifest = files['tau.json'];
  if (manifest === undefined) {
    throw new Error('SINOPIA_INVALID_MANIFEST');
  }
  const read = readProjectManifestBytes(manifest.content);
  if (!read.success || read.issue !== undefined) {
    throw new Error('SINOPIA_INVALID_MANIFEST');
  }
  const entry = read.data.assets.main.entryPath;
  if (files[entry] === undefined) {
    throw new Error('SINOPIA_INVALID_ENTRY');
  }
  const link: SinopiaCadLink = {
    modelId: model.id,
    projectId: model.project_id,
    userId: model.user_id,
    baseRevisionId: model.head_revision_id,
    /* What the head holds: the first revision this device mints of these files is the same model, not a change. The
       manifest counts as project creation writes it (`projectToManifest`, canonical bytes). */
    baseContentKey: await sinopiaCadContentKey({
      ...Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.content])),
      'tau.json': serializeProjectManifest(projectToManifest(read.data)),
    }),
  };
  files[sinopiaCadLinkPath] = { content: new TextEncoder().encode(JSON.stringify(link)) };
  return { project: read.data, files, link };
}

/**
 * A save Sinopia needs no upload for: its head already is this revision (a lost acknowledgement), or it diverged (a
 * conflict), or the revision is another commit of the very files it holds (the model opened on this computer from
 * Sinopia, a revision of nothing new) — then its head stays, with no new archive, row update or conflict elsewhere.
 */
function alreadyOnSinopia(
  remote: SinopiaCadModel,
  input: Readonly<{ link: SinopiaCadLink; revisionId: string; contentKey?: string }>,
  savedLink: SinopiaCadLink,
):
  | { kind: 'saved'; link: SinopiaCadLink; at: number; previewPending: boolean }
  | { kind: 'conflict'; remote: SinopiaCadModel }
  | undefined {
  const held = { at: Date.parse(remote.updated_at), previewPending: remote.thumbnail_path === null };
  if (remote.head_revision_id === input.revisionId && remote.snapshot_path !== null) {
    return { kind: 'saved', link: savedLink, ...held };
  }
  if (remote.head_revision_id !== input.link.baseRevisionId) {
    return { kind: 'conflict', remote };
  }
  if (
    input.contentKey !== undefined &&
    input.contentKey === input.link.baseContentKey &&
    remote.snapshot_path !== null
  ) {
    return { kind: 'saved', link: input.link, ...held };
  }
  return undefined;
}

/** Immutable upload + null-aware compare-and-swap; a racing winner's objects can never be overwritten. */
export async function saveSinopiaCadRevision(input: {
  link: SinopiaCadLink;
  revisionId: string;
  engine: SinopiaCadEngine;
  name: string;
  snapshot: Blob;
  thumbnail?: Uint8Array<ArrayBuffer>;
  signal?: AbortSignal;
  /** `sinopiaCadContentKey` of the snapshot: the same files as the acknowledged copy are not uploaded again. */
  contentKey?: string;
}): Promise<
  | { kind: 'saved'; link: SinopiaCadLink; at: number; previewPending?: boolean }
  | { kind: 'conflict'; remote: SinopiaCadModel }
> {
  input.signal?.throwIfAborted();
  const remote = await ensureSinopiaCadModel(input.link, input.name, input.engine);
  // The acknowledged keys travel with the head they describe; a save without one forgets the old one.
  const { baseContentKey: _previous, ...withoutContent } = input.link;
  const savedLink: SinopiaCadLink = {
    ...withoutContent,
    baseRevisionId: input.revisionId,
    ...(input.contentKey === undefined ? {} : { baseContentKey: input.contentKey }),
  };
  const held = alreadyOnSinopia(remote, input, savedLink);
  if (held !== undefined) {
    return held;
  }
  const { client } = await getSinopiaDataClient();
  await requireSinopiaUser(input.link.userId);
  const directory = `projects/${input.link.projectId}/cad/${input.link.modelId}/saves/${randomUuid()}`;
  const snapshotPath = `${directory}/model.zip`;
  const thumbnailPath = input.thumbnail === undefined ? null : `${directory}/thumbnail.webp`;
  const bucket = client.storage.from('creator-private');
  input.signal?.throwIfAborted();
  const uploaded = await bucket.upload(snapshotPath, input.snapshot, { contentType: 'application/zip', upsert: false });
  if (uploaded.error !== null) {
    throw uploaded.error;
  }
  if (input.thumbnail !== undefined && thumbnailPath !== null) {
    await requireSinopiaUser(input.link.userId);
    const preview = await bucket.upload(thumbnailPath, input.thumbnail, { contentType: 'image/webp', upsert: false });
    if (preview.error !== null) {
      throw preview.error;
    }
  }
  await requireSinopiaUser(input.link.userId);
  input.signal?.throwIfAborted();
  let update = client
    .from('cad_models')
    .update({
      engine: input.engine,
      name: projectNameOrDefault(input.name, 'Modello CAD'),
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase model wire column.
      head_revision_id: input.revisionId,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase model wire column.
      snapshot_path: snapshotPath,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase model wire column.
      thumbnail_path: thumbnailPath,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase model wire column.
      snapshot_bytes: input.snapshot.size,
    })
    .eq('id', input.link.modelId)
    .eq('user_id', input.link.userId)
    .eq('project_id', input.link.projectId)
    .is('deleted_at', null);
  update =
    input.link.baseRevisionId === null
      ? update.is('head_revision_id', null)
      : update.eq('head_revision_id', input.link.baseRevisionId);
  const { data, error } = await update.select('id');
  if (error !== null) {
    throw error;
  }
  await requireSinopiaUser(input.link.userId);
  if (!Array.isArray(data) || data.length !== 1) {
    const latest = await getSinopiaCadModel(input.link);
    if (latest === undefined) {
      throw new Error('SINOPIA_MODEL_UNAVAILABLE');
    }
    if (latest.head_revision_id === input.revisionId && latest.snapshot_path !== null) {
      return {
        kind: 'saved',
        link: savedLink,
        at: Date.parse(latest.updated_at),
        previewPending: latest.thumbnail_path === null,
      };
    }
    return { kind: 'conflict', remote: latest };
  }
  if (thumbnailPath !== null) {
    await adoptCadPreviewAsCover(client, input.link, thumbnailPath);
  }
  await adoptModelNameForProject(client, input.link, input.name);
  return {
    kind: 'saved',
    link: savedLink,
    at: Date.now(),
    previewPending: thumbnailPath === null,
  };
}

/** Account-scoped local routing hints contain ids only; the filesystem link remains authoritative. */
export const sinopiaCadLocalId = {
  get(userId: string, modelId: string): string {
    try {
      return localStorage.getItem(`sinopia:cad-local:${userId}:${modelId}`) ?? sinopiaModelLocalProjectId(modelId);
    } catch {
      return sinopiaModelLocalProjectId(modelId);
    }
  },
  set(userId: string, modelId: string, localId: string): void {
    try {
      localStorage.setItem(`sinopia:cad-local:${userId}:${modelId}`, localId);
    } catch {
      /* A remote model can still open under its UUID after storage is unavailable. */
    }
  },
};

/** Encode all UUID entropy in the project's existing 21-character base62 identity space. */
export function sinopiaModelLocalProjectId(modelId: string): string {
  const hex = z.uuid().parse(modelId).replaceAll('-', '');
  // UUID version and variant bits carry no identity entropy; the other 122 bits fit base62's 21 digits.
  let value = BigInt(
    `0x${hex.slice(0, 12)}${hex.slice(13, 16)}${(Number.parseInt(hex[16]!, 16) % 4).toString(16)}${hex.slice(17)}`,
  );
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let encoded = '';
  while (value > 0n) {
    encoded = alphabet[Number(value % 62n)]! + encoded;
    value /= 62n;
  }
  return `proj_${encoded.padStart(21, '0')}`;
}

/**
 * Give the Sinopia project its model's preview as cover when the project has none of its own, so the dashboard never
 * shows the CAD's project as an empty card. A cover the person chose (or the canvas set) is never replaced; one the CAD
 * set earlier follows the newest preview. The address is Sinopia's own convention, a public «assets» URL its dashboard
 * maps to the private bucket. Cosmetic: a failure leaves the saved preview as it is.
 */
async function adoptCadPreviewAsCover(
  client: Awaited<ReturnType<typeof getSinopiaDataClient>>['client'],
  link: SinopiaCadLink,
  path: string,
): Promise<void> {
  try {
    const cover = client.storage.from('assets').getPublicUrl(path).data.publicUrl;
    await client
      .from('projects')
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase project wire column.
      .update({ thumbnail_url: cover })
      .eq('id', link.projectId)
      .eq('user_id', link.userId)
      .is('deleted_at', null)
      .or('thumbnail_url.is.null,thumbnail_url.like.*/cad/*');
  } catch {
    // The cover is cosmetic; the preview stays on the CAD model either way.
  }
}

/**
 * A project the CAD itself created and named «Nuovo progetto» (nobody had a name yet) takes the model's name once it
 * has one: the name the assistant or the person gave the piece. Only the CAD's own project (`projectCreatedByCad`) and
 * only from that exact default: a project the person started from, or any name chosen on Sinopia, is never replaced.
 * Cosmetic, like the cover.
 */
async function adoptModelNameForProject(
  client: Awaited<ReturnType<typeof getSinopiaDataClient>>['client'],
  link: SinopiaCadLink,
  name: string,
): Promise<void> {
  if (link.projectCreatedByCad !== true || isPlaceholderProjectName(name)) {
    return;
  }
  try {
    await client
      .from('projects')
      .update({ name: projectNameOrDefault(name) })
      .eq('id', link.projectId)
      .eq('user_id', link.userId)
      .is('deleted_at', null)
      .eq('name', defaultProjectName);
  } catch {
    // The project keeps its default name; the model is saved either way.
  }
}

/** Add a late preview only to the same still-current source head; it never changes snapshot identity. */
export async function patchSinopiaCadThumbnail(input: {
  link: SinopiaCadLink;
  revisionId: string;
  thumbnail?: Uint8Array<ArrayBuffer>;
  isCurrent: () => boolean;
  signal?: AbortSignal;
}): Promise<
  | { kind: 'saved'; link: SinopiaCadLink; at: number; previewPending?: boolean }
  | { kind: 'conflict'; remote: SinopiaCadModel }
> {
  const remote = await getSinopiaCadModel(input.link);
  if (remote === undefined) {
    throw new Error('SINOPIA_MODEL_UNAVAILABLE');
  }
  if (remote.head_revision_id !== input.revisionId) {
    return { kind: 'conflict', remote };
  }
  if (input.thumbnail === undefined) {
    return {
      kind: 'saved',
      link: input.link,
      at: Date.parse(remote.updated_at),
      previewPending: remote.thumbnail_path === null,
    };
  }
  if (!input.isCurrent()) {
    throw new DOMException('Capture superseded.', 'AbortError');
  }
  input.signal?.throwIfAborted();
  const { client } = await getSinopiaDataClient();
  await requireSinopiaUser(input.link.userId);
  const path = `projects/${input.link.projectId}/cad/${input.link.modelId}/saves/${randomUuid()}/thumbnail.webp`;
  const uploaded = await client.storage
    .from('creator-private')
    .upload(path, input.thumbnail, { contentType: 'image/webp', upsert: false });
  if (uploaded.error !== null) {
    throw uploaded.error;
  }
  input.signal?.throwIfAborted();
  if (!input.isCurrent()) {
    throw new DOMException('Capture superseded.', 'AbortError');
  }
  await requireSinopiaUser(input.link.userId);
  const { data, error } = await client
    .from('cad_models')
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase thumbnail wire column.
    .update({ thumbnail_path: path })
    .eq('id', input.link.modelId)
    .eq('project_id', input.link.projectId)
    .eq('user_id', input.link.userId)
    .eq('head_revision_id', input.revisionId)
    .is('deleted_at', null)
    .select('id');
  if (error !== null) {
    throw error;
  }
  await requireSinopiaUser(input.link.userId);
  if (!Array.isArray(data) || data.length !== 1) {
    const latest = await getSinopiaCadModel(input.link);
    if (latest === undefined) {
      throw new Error('SINOPIA_MODEL_UNAVAILABLE');
    }
    return { kind: 'conflict', remote: latest };
  }
  await adoptCadPreviewAsCover(client, input.link, path);
  return { kind: 'saved', link: input.link, at: Date.now(), previewPending: false };
}

// ---------------------------------------------------------------------------
// One project per piece: finding the model a Sinopia part already has, and moving a model to another project
// ---------------------------------------------------------------------------

/** A Sinopia image part of one account: the key of the device's memory. */
export type SinopiaCadSourceKey = Readonly<{ userId: string; projectId: string; assetId: string; partId: string }>;

/** Where the device remembers which model a Sinopia part became (ids only, per account). */
const sourceHintKey = ({ userId, projectId, assetId, partId }: SinopiaCadSourceKey): string =>
  `sinopia:cad-source:${userId}:${projectId}:${assetId}:${partId}`;

/**
 * The device's memory of «this part became that model»: it works before the origin columns exist on Sinopia and before
 * the model's first save. The database answer, when there is one, comes first.
 */
export const sinopiaCadSourceHint = {
  get(key: SinopiaCadSourceKey): string | undefined {
    try {
      const value = localStorage.getItem(sourceHintKey(key)) ?? undefined;
      return value !== undefined && z.uuid().safeParse(value).success ? value : undefined;
    } catch {
      return undefined;
    }
  },
  set(key: SinopiaCadSourceKey, modelId: string): void {
    try {
      localStorage.setItem(sourceHintKey(key), modelId);
    } catch {
      /* Without storage the database origin still finds the model. */
    }
  },
};

/** The model a part of a project's image already became, as the page asking «open it or redo it?» needs it. */
export type SinopiaCadModelForPart = Readonly<{ id: string; name: string; projectId: string }>;

/**
 * The newest active model of this account built from this image part of this project, from the origin columns.
 * Before the migration the columns are missing and the answer is «none» (the device's hint takes over).
 */
export async function findSinopiaCadModelForPart(input: {
  projectId: string;
  assetId: string;
  partId: string;
}): Promise<SinopiaCadModelForPart | undefined> {
  if (
    !z.uuid().safeParse(input.projectId).success ||
    !z.uuid().safeParse(input.assetId).success ||
    !partIdSchema.safeParse(input.partId).success
  ) {
    return undefined;
  }
  const { client, userId } = await getSinopiaDataClient();
  const { data, error } = await client
    .from('cad_models')
    .select('id,name,project_id,user_id')
    .eq('user_id', userId)
    .eq('project_id', input.projectId.toLowerCase())
    .eq('source_asset_id', input.assetId.toLowerCase())
    .eq('source_part_id', input.partId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error !== null) {
    if (isMissingOriginColumn(error)) {
      return undefined;
    }
    throw error;
  }
  await requireSinopiaUser(userId);
  if (data === null) {
    return undefined;
  }
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase model wire columns.
  const row = z.object({ id: z.uuid(), name: z.string(), project_id: z.uuid(), user_id: z.uuid() }).parse(data);
  return row.user_id === userId ? { id: row.id, name: row.name, projectId: row.project_id } : undefined;
}

/** A project of this account the person may link a model to. */
export type SinopiaCadProjectChoice = Readonly<{ id: string; name: string }>;

const storagePrefix = (projectId: string, modelId: string): string => `projects/${projectId}/cad/${modelId}/`;

/** Every object under one model's folder, walking the storage «folders» (entries without an id). */
async function listModelObjects(
  bucket: ReturnType<Awaited<ReturnType<typeof getSinopiaDataClient>>['client']['storage']['from']>,
  prefix: string,
): Promise<string[]> {
  const found: string[] = [];
  const pending = [prefix.replace(/\/$/u, '')];
  while (pending.length > 0 && found.length < 2000) {
    const folder = pending.shift()!;
    // oxlint-disable-next-line no-await-in-loop -- Folders are walked one at a time: the listing is small and bounded.
    const { data, error } = await bucket.list(folder, { limit: 1000 });
    if (error !== null) {
      throw error;
    }
    for (const entry of data) {
      const path = `${folder}/${entry.name}`;
      if (entry.id === null) {
        pending.push(path);
      } else {
        found.push(path);
      }
    }
  }
  return found;
}

const moveRowSchema = z.object({
  id: z.uuid(),
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase asset wire columns.
  storage_path: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

/** Swap the old model folder for the new one in a stored path; any other value stays as it is. */
function movedPath(value: unknown, from: string, to: string): unknown {
  return typeof value === 'string' && value.startsWith(from) ? `${to}${value.slice(from.length)}` : value;
}

/**
 * The account's active row of a model by its identity alone (`id` + `user_id`), wherever it is: the guard that sees a
 * model moved to another project by a move whose last step (the local link) did not happen, or by another device.
 */
export async function findSinopiaCadModelAnywhere(
  link: Pick<SinopiaCadLink, 'modelId' | 'userId'>,
): Promise<SinopiaCadModel | undefined> {
  const { client } = await getSinopiaDataClient();
  await requireSinopiaUser(link.userId);
  const { data, error } = await client
    .from('cad_models')
    .select(columns)
    .eq('id', link.modelId)
    .eq('user_id', link.userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error !== null) {
    throw error;
  }
  await requireSinopiaUser(link.userId);
  if (data === null) {
    return undefined;
  }
  const row = sinopiaCadModelSchema.parse(data);
  if (row.user_id !== link.userId) {
    throw new Error('SINOPIA_OWNER_MISMATCH');
  }
  return row;
}

/**
 * Repair a local link whose model now lives in another Sinopia project (an interrupted «cambia», another device): the
 * link follows the row, never the other way round. The origin stays only if it was the row's own project's; the CAD's
 * «created this project» mark does not travel.
 *
 * @returns The link to use: the same one, or the repaired one already written.
 */
export async function reconcileSinopiaCadLink(
  files: Pick<SinopiaCadRecordFiles, 'writeFile'>,
  root: string,
  link: SinopiaCadLink,
): Promise<SinopiaCadLink> {
  const remote = await findSinopiaCadModelAnywhere(link);
  if (remote === undefined || remote.project_id === link.projectId) {
    return link;
  }
  const { sourceAssetId: _asset, sourcePartId: _part, projectCreatedByCad: _created, ...rest } = link;
  const repaired: SinopiaCadLink = { ...rest, projectId: remote.project_id };
  await writeSinopiaCadLink(files, root, repaired);
  return repaired;
}

/**
 * «Progetto Sinopia: cambia»: the model (its `cad_models` row, its saved files and the versions sent with «Invia a
 * Sinopia») moves to another project of the same account, and the local link follows.
 *
 * Nothing is deleted, and every step can run again: the files are COPIED to the new project's folder (the table's CHECK
 * ties every path to its project; a copy already there is fine), the row moves in one compare-and-swap update guarded
 * by the RESTRICTIVE policy «a CAD model stays in its owner's projects» (a project of someone else is refused by the
 * database, not only here), then each sent version follows. Any failure stops the move before the local link is
 * written and is thrown: «Sposta» again resumes from the row, wherever it already is. A link left behind by a stop is
 * repaired on the next open (`reconcileSinopiaCadLink`).
 *
 * After the move the old project forgets a cover that was this model's preview, and the new one takes the preview as
 * cover only if it has none of its own (an image always wins over the CAD).
 *
 * A model never saved yet (no row) only changes its link: its first save registers it in the new project.
 */
export async function moveSinopiaCadModel(input: {
  link: SinopiaCadLink;
  targetProjectId: string;
  files: Pick<SinopiaCadRecordFiles, 'writeFile'>;
  localProjectId: string;
  /** The origin inside the target project, when the caller knows it (the recognition record of a piece). */
  source?: SinopiaCadSource;
}): Promise<SinopiaCadLink> {
  const target = z.uuid().parse(input.targetProjectId).toLowerCase();
  const { link } = input;
  if (target === link.projectId) {
    return link;
  }
  const { client } = await getSinopiaDataClient();
  await requireSinopiaUser(link.userId);
  const owned = await client
    .from('projects')
    .select('id')
    .eq('id', target)
    .eq('user_id', link.userId)
    .is('deleted_at', null)
    .maybeSingle();
  if (owned.error !== null || owned.data === null) {
    throw new Error('SINOPIA_PROJECT_UNAVAILABLE');
  }
  const { sourceAssetId: _asset, sourcePartId: _part, projectCreatedByCad: _created, ...rest } = link;
  const moved = withSinopiaCadSource({ ...rest, projectId: target }, input.source);
  const remote = await findSinopiaCadModelAnywhere(link);
  if (remote !== undefined) {
    if (remote.project_id !== link.projectId && remote.project_id !== target) {
      // Moved elsewhere meanwhile (another device): the next open repairs the link; nothing is overwritten here.
      throw new Error('SINOPIA_MODEL_MOVED');
    }
    const move: MoveContext = {
      client,
      link,
      remote,
      moved,
      target,
      from: storagePrefix(link.projectId, link.modelId),
      to: storagePrefix(target, link.modelId),
    };
    await copyModelObjects(move);
    if (remote.project_id === link.projectId) {
      await moveModelRow(move);
    }
    await moveSentVersions(move);
    await moveCovers(move);
  }
  await requireSinopiaUser(link.userId);
  await writeSinopiaCadLink(input.files, `/projects/${input.localProjectId}`, moved);
  if (moved.sourceAssetId !== undefined && moved.sourcePartId !== undefined) {
    sinopiaCadSourceHint.set(
      { userId: link.userId, projectId: target, assetId: moved.sourceAssetId, partId: moved.sourcePartId },
      link.modelId,
    );
  }
  return moved;
}

/** One move: the client, the link before it, the row as found, the link after it, the target and the two folders. */
type MoveContext = Readonly<{
  client: Awaited<ReturnType<typeof getSinopiaDataClient>>['client'];
  link: SinopiaCadLink;
  remote: SinopiaCadModel;
  moved: SinopiaCadLink;
  target: string;
  from: string;
  to: string;
}>;

/** Copy every object of the model's old folder to the new one; an object already copied by an earlier try is fine. */
async function copyModelObjects({ client, link, from, to }: MoveContext): Promise<void> {
  const bucket = client.storage.from('creator-private');
  for (const path of await listModelObjects(bucket, from)) {
    // oxlint-disable-next-line no-await-in-loop -- Recheck the account before every write.
    await requireSinopiaUser(link.userId);
    // oxlint-disable-next-line no-await-in-loop -- One copy at a time: a retry finds the earlier copies already there.
    const copied = await bucket.copy(path, `${to}${path.slice(from.length)}`);
    if (copied.error !== null && !/exist/iu.test(copied.error.message)) {
      throw copied.error;
    }
  }
}

/** The row moves in ONE compare-and-swap on its old project, with its paths and its origin in the new project. */
async function moveModelRow(paths: MoveContext): Promise<void> {
  const { client, link, remote } = paths;
  await requireSinopiaUser(link.userId);
  /* eslint-disable @typescript-eslint/naming-convention -- Supabase model wire columns. */
  const row = {
    project_id: paths.target,
    snapshot_path: movedPath(remote.snapshot_path, paths.from, paths.to) as string | null,
    thumbnail_path: movedPath(remote.thumbnail_path, paths.from, paths.to) as string | null,
  };
  const originColumns = {
    source_asset_id: paths.moved.sourceAssetId ?? null,
    source_part_id: paths.moved.sourcePartId ?? null,
  };
  /* eslint-enable @typescript-eslint/naming-convention -- Back to camelCase. */
  const update = async (values: Record<string, unknown>) =>
    client
      .from('cad_models')
      .update(values)
      .eq('id', link.modelId)
      .eq('user_id', link.userId)
      .eq('project_id', link.projectId)
      .is('deleted_at', null)
      .select('id');
  let result = await update({ ...row, ...originColumns });
  if (result.error !== null && isMissingOriginColumn(result.error)) {
    result = await update(row);
  }
  if (result.error !== null) {
    throw result.error;
  }
  if (!Array.isArray(result.data) || result.data.length !== 1) {
    throw new Error('SINOPIA_MODEL_UNAVAILABLE');
  }
}

/** Each version sent from the old project follows, with its paths; any failure stops the move (it can run again). */
async function moveSentVersions(paths: MoveContext): Promise<void> {
  const { client, link } = paths;
  const versions = await client
    .from('assets')
    .select('id,storage_path,metadata')
    .eq('user_id', link.userId)
    .eq('project_id', link.projectId)
    .eq('type', 'cad_model')
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Persisted Supabase JSON field.
    .contains('metadata', { cad_model_id: link.modelId });
  if (versions.error !== null) {
    throw versions.error;
  }
  for (const version of z.array(moveRowSchema).parse(versions.data)) {
    const metadata = version.metadata ?? {};
    const listed: unknown = metadata['files'];
    const files = Array.isArray(listed)
      ? listed.map((file: unknown) =>
          file !== null && typeof file === 'object'
            ? {
                ...(file as Record<string, unknown>),
                // eslint-disable-next-line @typescript-eslint/naming-convention -- Persisted metadata key.
                storage_path: movedPath((file as Record<string, unknown>)['storage_path'], paths.from, paths.to),
              }
            : file,
        )
      : listed;
    /* eslint-disable @typescript-eslint/naming-convention -- Supabase asset wire columns and persisted metadata keys. */
    const values = {
      project_id: paths.target,
      storage_path: movedPath(version.storage_path, paths.from, paths.to),
      metadata: {
        ...metadata,
        files,
        thumbnail_path: movedPath(metadata['thumbnail_path'], paths.from, paths.to),
        source_asset_id: paths.moved.sourceAssetId ?? null,
        source_part_id: paths.moved.sourcePartId ?? null,
      },
    };
    /* eslint-enable @typescript-eslint/naming-convention -- Back to camelCase. */
    // oxlint-disable-next-line no-await-in-loop -- Recheck the account before every write.
    await requireSinopiaUser(link.userId);
    // oxlint-disable-next-line no-await-in-loop -- One version at a time; a failure stops before the link is written.
    const versionMoved = await client
      .from('assets')
      .update(values)
      .eq('id', version.id)
      .eq('user_id', link.userId)
      .eq('project_id', link.projectId);
    if (versionMoved.error !== null) {
      throw versionMoved.error;
    }
  }
}

/**
 * The covers follow the model: the old project forgets a cover that was this model's preview (it would point at a
 * folder of another project), the new one takes the preview only where it has no cover of its own. Cosmetic.
 */
async function moveCovers(paths: MoveContext): Promise<void> {
  const { client, link, remote } = paths;
  try {
    await client
      .from('projects')
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase project wire column.
      .update({ thumbnail_url: null })
      .eq('id', link.projectId)
      .eq('user_id', link.userId)
      .like('thumbnail_url', `%/cad/${link.modelId}/%`);
  } catch {
    // A stale cover only shows the old preview; the move itself is complete.
  }
  const thumbnail = movedPath(remote.thumbnail_path, paths.from, paths.to);
  if (typeof thumbnail === 'string' && thumbnail.startsWith(paths.to)) {
    await adoptCadPreviewAsCover(client, { ...link, projectId: paths.target }, thumbnail);
  }
}

/**
 * The origin of a piece built from a Sinopia part, read back from its recognition record, when the record's project is
 * the target: the part id, and the image's `assets.id` found by its storage path. Used when an older model, made before
 * the link kept its origin, is moved back to the project it came from.
 */
export async function sourceFromRecognition(input: {
  record: Readonly<{
    schedaParte: Readonly<{ progetto: { id: string }; immagine: { path: string }; parte: { id: string } }>;
  }>;
  targetProjectId: string;
  userId: string;
}): Promise<SinopiaCadSource | undefined> {
  const { schedaParte } = input.record;
  if (schedaParte.progetto.id.toLowerCase() !== input.targetProjectId.toLowerCase()) {
    return undefined;
  }
  try {
    const { client } = await getSinopiaDataClient();
    await requireSinopiaUser(input.userId);
    const { data, error } = await client
      .from('assets')
      .select('id')
      .eq('user_id', input.userId)
      .eq('project_id', input.targetProjectId)
      .eq('storage_path', schedaParte.immagine.path)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    const found = error === null ? z.object({ id: z.uuid() }).safeParse(data) : undefined;
    if (found?.success !== true) {
      return undefined;
    }
    return partIdSchema.safeParse(schedaParte.parte.id).success
      ? { assetId: found.data.id, partId: schedaParte.parte.id }
      : { assetId: found.data.id };
  } catch {
    return undefined;
  }
}
