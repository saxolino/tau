/* oxlint-disable typescript/no-restricted-types -- Supabase nullable heads and paths are part of its wire contract. */
import { z } from 'zod';
import { classify } from '@taucad/filesystem/path-registry';
import { archive, archiveByteCeiling } from '@taucad/filesystem/content-ops';
import { MemoryProvider } from '@taucad/filesystem/backend';
import { readProjectManifestBytes } from '@taucad/types';
import type { ProjectManifest } from '@taucad/types';
import { base64ToUint8Array } from 'uint8array-extras';
import { getSinopiaDataClient, requireSinopiaUser } from '#lib/sinopia-data-client.js';
import type { RootedContentClient } from '@taucad/fs-client/rooted-content-client';
import { randomUuid } from '@taucad/utils/id';
export type SinopiaCadRecordFiles = Pick<RootedContentClient, 'writeFile' | 'exists' | 'readdir'> & {
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer>>;
};

export const sinopiaCadLinkPath = '.tau/sinopia.json';
const revisionSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
export const sinopiaCadLinkSchema = z.object({
  modelId: z.uuid(),
  projectId: z.uuid(),
  userId: z.uuid(),
  baseRevisionId: revisionSchema.nullable(),
  localRevisionId: revisionSchema.optional(),
  previewPending: z.boolean().optional(),
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

/** Mint a recoverable local identity first; the chosen engine registers its model on the first authored save. */
export async function createSinopiaCadLink(
  name: string,
  originProjectId?: string,
  modelId = randomUuid(),
): Promise<SinopiaCadLink> {
  const { client, userId } = await getSinopiaDataClient();
  let projectId = originProjectId;
  if (projectId === undefined) {
    projectId = randomUuid();
    const { error } = await client
      .from('projects')
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase project wire columns.
      .insert({ id: projectId, user_id: userId, name, vertical: 'accessories' });
    if (error !== null) {
      throw error;
    }
  } else {
    z.uuid().parse(projectId);
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
  }
  await requireSinopiaUser(userId);
  return { modelId, projectId, userId, baseRevisionId: null };
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
  const { error } = await client.from('cad_models').upsert(
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase model wire columns.
    { id: link.modelId, project_id: link.projectId, user_id: link.userId, name, engine },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error !== null) {
    throw error;
  }
  const registered = await getSinopiaCadModel(link);
  if (registered === undefined) {
    throw new Error('SINOPIA_MODEL_UNAVAILABLE');
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
  };
  files[sinopiaCadLinkPath] = { content: new TextEncoder().encode(JSON.stringify(link)) };
  return { project: read.data, files, link };
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
}): Promise<
  | { kind: 'saved'; link: SinopiaCadLink; at: number; previewPending?: boolean }
  | { kind: 'conflict'; remote: SinopiaCadModel }
> {
  input.signal?.throwIfAborted();
  const remote = await ensureSinopiaCadModel(input.link, input.name, input.engine);
  if (remote.head_revision_id === input.revisionId && remote.snapshot_path !== null) {
    return {
      kind: 'saved',
      link: { ...input.link, baseRevisionId: input.revisionId },
      at: Date.parse(remote.updated_at),
      previewPending: remote.thumbnail_path === null,
    };
  }
  if (remote.head_revision_id !== input.link.baseRevisionId) {
    return { kind: 'conflict', remote };
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
      name: input.name,
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
        link: { ...input.link, baseRevisionId: input.revisionId },
        at: Date.parse(latest.updated_at),
        previewPending: latest.thumbnail_path === null,
      };
    }
    return { kind: 'conflict', remote: latest };
  }
  return {
    kind: 'saved',
    link: { ...input.link, baseRevisionId: input.revisionId },
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
  return { kind: 'saved', link: input.link, at: Date.now(), previewPending: false };
}
