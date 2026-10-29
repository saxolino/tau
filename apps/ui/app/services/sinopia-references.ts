import { z } from 'zod';
import { getSinopiaDataClient } from '#lib/sinopia-data-client.js';
import { createAttachmentStore } from '#db/attachment-store.js';
import type { AttachmentClient } from '#db/attachment-store.js';
import { homeComposerScope, sinopiaComposerOriginPath } from '#db/home-composer-scope.js';
import type { AttachmentReference } from '#utils/attachment.utils.js';
import { ENV } from '#environment.config.js';

const imageTypes = ['ai_render', 'ai_edit', 'approved_design', 'paper_upload', 'canvas_snapshot'] as const;
/* eslint-disable @typescript-eslint/naming-convention -- These Zod objects describe Supabase column names verbatim; domain types below use camelCase. */
const projectSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  updated_at: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  canvas_thumbnail_url: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  thumbnail_url: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
});
const thumbnailSchema = z.object({
  project_id: z.string(),
  thumbnail_url: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
});
const assetSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  project_id: z.string(),
  type: z.enum(imageTypes),
  storage_bucket: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  storage_path: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined),
  public_url: z
    .string()
    .nullable()
    .transform((value) => value ?? undefined)
    .optional(),
});
const librarySchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  image_url: z.string(),
  width_mm: z
    .number()
    .nullable()
    .transform((value) => value ?? undefined),
  height_mm: z
    .number()
    .nullable()
    .transform((value) => value ?? undefined),
});

/* eslint-enable @typescript-eslint/naming-convention -- The remaining domain API uses camelCase. */

/** A storage reference, never an arbitrary image URL. */
export type SinopiaImageLocation = Readonly<{ bucket: string; path: string }>;
/** A dashboard project owned by the admitted account. */
export type SinopiaReferenceProject = Readonly<{
  id: string;
  userId: string;
  name: string;
  updatedAt: string | undefined;
  imageCount?: number;
  /** The cover and the owned project whose folder holds it: a Sinopia duplicate shares its original's media. */
  thumbnail: (SinopiaImageLocation & Readonly<{ projectId: string }>) | undefined;
}>;
/** One image the designer can copy into the CAD's first message. */
export type SinopiaReferenceImage = Readonly<{
  id: string;
  userId: string;
  projectId: string;
  kind: 'render' | 'drawing' | 'library';
  name: string | undefined;
  location: SinopiaImageLocation;
  widthMm?: number | undefined;
  heightMm?: number | undefined;
}>;
/** Original images retained until the first project submission. */
export type SinopiaReferenceSelection = Readonly<{
  userId: string;
  projectId: string;
  files: readonly File[];
  measurements?: ReadonlyArray<
    Readonly<{
      filename: string;
      name?: string;
      widthMm?: number | undefined;
      heightMm?: number | undefined;
    }>
  >;
}>;

/**
 * Sinopia keeps the public `assets` URL as the durable name of private media: the bytes of these namespaces moved to
 * `creator-private` under the same path (`requestFileReference` in Sinopia's `supabase/functions/_shared`).
 */
const privateMediaNamespace = /^(?:projects|users|meshy-uploads|models-3d|videos|components)\//u;
/** Owner-keyed namespaces of `creator-private`, as Sinopia's `requestSourceLocationOwned` admits them. */
const ownerNamespaces = new Set([
  'users',
  'meshy-uploads',
  'models-3d',
  'videos',
  'components',
  'legacy-inspiration',
  'legacy-library-components',
]);

/** Accept only this Supabase project's Storage URLs; tokens and URL query strings never propagate. */
export function sinopiaImageLocation(url: string | undefined): SinopiaImageLocation | undefined {
  const base = ENV.SINOPIA_SUPABASE_URL;
  if (!url || !base) {
    return undefined;
  }
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(base).origin) {
      return undefined;
    }
    const match = /^\/storage\/v1\/object\/(?:public|authenticated|sign)\/([^/]+)\/(.+)$/.exec(parsed.pathname);
    if (!match?.[1] || !match[2]) {
      return undefined;
    }
    const path = decodeURIComponent(match[2]);
    if (path.split('/').some((part) => part === '..' || part === '.' || part === '')) {
      return undefined;
    }
    const bucket = decodeURIComponent(match[1]);
    return { bucket: bucket === 'assets' && privateMediaNamespace.test(path) ? 'creator-private' : bucket, path };
  } catch {
    return undefined;
  }
}

/** The account's own private media: this project's folder or one of the owner's folders, never another account's. */
const isProjectImage = (location: SinopiaImageLocation, projectId: string, userId: string): boolean => {
  const parts = location.path.split('/');
  return (
    location.bucket === 'creator-private' &&
    parts.length > 2 &&
    !/[\\%]/u.test(location.path) &&
    !parts.some((part) => part === '..' || part === '.' || part === '') &&
    ((parts[0] === 'projects' && parts[1] === projectId) || (ownerNamespaces.has(parts[0]!) && parts[1] === userId))
  );
};

/** Same owner/deletion/Learn/Network filters and stable pagination as Sinopia's dashboard, across verticals. */
export async function listSinopiaReferenceProjects(signal?: AbortSignal): Promise<SinopiaReferenceProject[]> {
  const { client, userId } = await getSinopiaDataClient();
  const projects: Array<z.infer<typeof projectSchema>> = [];
  for (let offset = 0; ; offset += 500) {
    let query = client
      .from('projects')
      .select('id,user_id,name,updated_at,canvas_thumbnail_url,thumbnail_url')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .is('metadata->>learn', null)
      .or('metadata->>lavoro_network.is.null,metadata->>lavoro_network.neq.true')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + 499);
    if (signal) {
      query = query.abortSignal(signal);
    }
    // oxlint-disable-next-line no-await-in-loop -- sequential pages bound memory and preserve dashboard ordering
    const result = await query;
    if (result.error) {
      throw new Error('Sinopia project list unavailable');
    }
    const page = z.array(projectSchema).parse(result.data);
    projects.push(...page.filter((row) => row.user_id === userId));
    if (page.length < 500) {
      break;
    }
  }
  let query = client.rpc('get_my_project_thumbnails');
  if (signal) {
    query = query.abortSignal(signal);
  }
  const thumbnails = await query;
  const parsed = z.array(thumbnailSchema).safeParse(thumbnails.error ? [] : thumbnails.data);
  const byId = new Map(parsed.success ? parsed.data.map((row) => [row.project_id, row.thumbnail_url]) : []);
  const counts = new Map<string, number>();
  let countsAvailable = true;
  if (projects.length > 0) {
    for (let offset = 0; ; offset += 500) {
      let query = client
        .from('assets')
        .select('project_id')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .in('type', [...imageTypes])
        .order('id', { ascending: true })
        .range(offset, offset + 499);
      if (signal) {
        query = query.abortSignal(signal);
      }
      // oxlint-disable-next-line no-await-in-loop -- count only lightweight owner-scoped rows without a server row-limit truncation
      const result = await query;
      const page = z
        .array(
          z.object({
            // eslint-disable-next-line @typescript-eslint/naming-convention -- Preserve the Supabase count projection column.
            project_id: z
              .string()
              .nullable()
              .transform((value) => value ?? undefined),
          }),
        )
        .safeParse(result.data);
      if (result.error !== null || !page.success) {
        countsAvailable = false;
        break;
      }
      for (const row of page.data) {
        if (row.project_id) {
          counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
        }
      }
      if (page.data.length < 500) {
        break;
      }
    }
  }
  const owned = new Set(projects.map((row) => row.id));
  const cover = (url: string | undefined, projectId: string): SinopiaReferenceProject['thumbnail'] => {
    const location = sinopiaImageLocation(url);
    if (location === undefined) {
      return undefined;
    }
    const folder = location.path.startsWith('projects/') ? location.path.split('/')[1] : undefined;
    const holder = folder !== undefined && owned.has(folder) ? folder : projectId;
    return isProjectImage(location, holder, userId) ? { ...location, projectId: holder } : undefined;
  };
  return [...new Map(projects.map((row) => [row.id, row])).values()].map((row) => {
    // The dashboard's order (canvas, then the server's pick, then the stored one); the first private owned cover wins.
    const thumbnail = [row.canvas_thumbnail_url, byId.get(row.id), row.thumbnail_url]
      .map((url) => cover(url, row.id))
      .find((location) => location !== undefined);
    return {
      id: row.id,
      userId,
      name: row.name,
      updatedAt: row.updated_at,
      ...(countsAvailable ? { imageCount: counts.get(row.id) ?? 0 } : {}),
      thumbnail,
    };
  });
}

/** Read owned active images plus owned library pieces; a project's identity is checked before either query. */
export async function listSinopiaReferenceImages(
  projectId: string,
  signal?: AbortSignal,
): Promise<SinopiaReferenceImage[]> {
  const { client, userId } = await getSinopiaDataClient();
  let ownerQuery = client
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('user_id', userId)
    .is('deleted_at', null);
  if (signal) {
    ownerQuery = ownerQuery.abortSignal(signal);
  }
  const owner = await ownerQuery.maybeSingle();
  if (owner.error !== null || owner.data === null) {
    throw new Error('Sinopia project unavailable');
  }
  const images: SinopiaReferenceImage[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = client
      .from('assets')
      .select('id,user_id,project_id,type,storage_bucket,storage_path,public_url')
      .eq('user_id', userId)
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .in('type', [...imageTypes])
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + 499);
    if (signal) {
      query = query.abortSignal(signal);
    }
    // oxlint-disable-next-line no-await-in-loop -- sequential pages avoid truncating large projects
    const result = await query;
    if (result.error) {
      throw new Error('Sinopia images unavailable');
    }
    const page = z.array(z.unknown()).parse(result.data);
    for (const value of page) {
      const parsed = assetSchema.safeParse(value);
      if (!parsed.success) {
        continue;
      }
      const row = parsed.data;
      const location =
        row.storage_bucket && row.storage_path
          ? { bucket: row.storage_bucket, path: row.storage_path }
          : sinopiaImageLocation(row.public_url);
      if (
        row.user_id === userId &&
        row.project_id === projectId &&
        location &&
        isProjectImage(location, projectId, userId)
      ) {
        images.push({
          id: row.id,
          userId,
          projectId,
          location,
          name: undefined,
          kind: row.type === 'paper_upload' || row.type === 'canvas_snapshot' ? 'drawing' : 'render',
        });
      }
    }
    if (page.length < 500) {
      break;
    }
  }
  for (let offset = 0; ; offset += 500) {
    let query = client
      .from('library_components')
      .select('id,user_id,name,image_url,width_mm,height_mm')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + 499);
    if (signal) {
      query = query.abortSignal(signal);
    }
    // oxlint-disable-next-line no-await-in-loop -- own library pagination follows the same bounded query contract
    const result = await query;
    if (result.error) {
      throw new Error('Sinopia library unavailable');
    }
    const page = z.array(z.unknown()).parse(result.data);
    for (const value of page) {
      const parsed = librarySchema.safeParse(value);
      if (!parsed.success) {
        continue;
      }
      const row = parsed.data;
      const location = sinopiaImageLocation(row.image_url);
      const isOwnedLocation =
        location &&
        ((location.bucket === 'library-components' && location.path.startsWith(`${userId}/`)) ||
          isProjectImage(location, projectId, userId));
      if (row.user_id === userId && location && isOwnedLocation) {
        images.push({
          id: `library-${row.id}`,
          userId,
          projectId,
          location,
          name: row.name,
          kind: 'library',
          widthMm: row.width_mm,
          heightMm: row.height_mm,
        });
      }
    }
    if (page.length < 500) {
      break;
    }
  }
  return images;
}

/**
 * The name of one of the admitted account's Sinopia projects, for a caption («Da Sinopia · <name>»). Undefined when it
 * cannot be read: offline, deleted, another account's, or the account changed while reading.
 */
export async function readSinopiaProjectName(projectId: string, signal?: AbortSignal): Promise<string | undefined> {
  const { client, userId } = await getSinopiaDataClient();
  let query = client.from('projects').select('name').eq('id', projectId).eq('user_id', userId).is('deleted_at', null);
  if (signal) {
    query = query.abortSignal(signal);
  }
  const { data, error } = await query.maybeSingle();
  const parsed = z.object({ name: z.string() }).safeParse(data);
  if (error !== null || !parsed.success) {
    return undefined;
  }
  const current = await getSinopiaDataClient();
  return current.userId === userId ? parsed.data.name.trim() || undefined : undefined;
}

/** Download with the current admitted user's JWT through Storage; no public or signed URLs enter the composer. */
export async function downloadSinopiaReferenceImage(
  image: Readonly<{ userId: string; projectId: string; location: SinopiaImageLocation }>,
): Promise<Blob> {
  const { client, userId } = await getSinopiaDataClient();
  if (image.userId !== userId) {
    throw new Error('Sinopia account changed');
  }
  const isOwnLibrary =
    image.location.bucket === 'library-components' &&
    image.location.path.startsWith(`${userId}/`) &&
    !image.location.path.split('/').some((part) => part === '..' || part === '.' || part === '');
  if (!isOwnLibrary && !isProjectImage(image.location, image.projectId, userId)) {
    throw new Error('Sinopia image unavailable');
  }
  const { data, error } = await client.storage.from(image.location.bucket).download(image.location.path);
  if (
    error !== null ||
    !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(data.type) ||
    data.size > 20 * 1024 * 1024
  ) {
    throw new Error('Sinopia image unavailable');
  }
  const current = await getSinopiaDataClient();
  if (current.userId !== userId) {
    throw new Error('Sinopia account changed');
  }
  return data;
}

/** Keep origin and reference copies only for images still present in this account's draft. */
export async function prepareSinopiaReferenceSelection(
  selection: SinopiaReferenceSelection | undefined,
  attachments: ReadonlyArray<Readonly<{ filename?: string; mediaType: string }>>,
): Promise<{ sinopiaProjectId?: string; files?: Record<string, { content: Uint8Array<ArrayBuffer> }> }> {
  if (!selection) {
    return {};
  }
  const files = selection.files.filter((file) =>
    attachments.some((attachment) => attachment.mediaType.startsWith('image/') && attachment.filename === file.name),
  );
  if (files.length === 0) {
    return {};
  }
  if (
    files.some((file) => file.name.includes('/') || file.name.includes('\\') || file.name === '.' || file.name === '..')
  ) {
    throw new Error('Invalid reference name');
  }
  const { userId } = await getSinopiaDataClient();
  if (selection.userId !== userId) {
    throw new Error('Sinopia account changed');
  }
  const entries = await Promise.all(
    files.map(
      async (file) => [`riferimenti/${file.name}`, { content: new Uint8Array(await file.arrayBuffer()) }] as const,
    ),
  );
  const measurements = selection.measurements?.filter((item) => files.some((file) => file.name === item.filename));
  if (measurements && measurements.length > 0) {
    entries.push(['riferimenti/misure.json', { content: new TextEncoder().encode(JSON.stringify(measurements)) }]);
  }
  const current = await getSinopiaDataClient();
  if (current.userId !== userId) {
    throw new Error('Sinopia account changed');
  }
  return { sinopiaProjectId: selection.projectId, files: Object.fromEntries(entries) };
}

const originSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  filenames: z.array(z.string().regex(/^sinopia-[\da-f-]+\.(?:jpg|jpeg|png|webp|gif)$/)),
  measurements: z
    .array(
      z.object({
        filename: z.string(),
        name: z.string().optional(),
        widthMm: z
          .number()
          .nullable()
          .transform((value) => value ?? undefined)
          .optional(),
        heightMm: z
          .number()
          .nullable()
          .transform((value) => value ?? undefined)
          .optional(),
      }),
    )
    .optional(),
});

/** Retain all still-attached reference bytes when picking again; the latest chosen project owns the new CAD. */
export function mergeSinopiaReferenceSelections(
  previous: SinopiaReferenceSelection | undefined,
  selection: SinopiaReferenceSelection,
  attachments: ReadonlyArray<Readonly<{ filename?: string }>>,
): SinopiaReferenceSelection {
  const retainedFiles =
    previous?.files.filter((file) => attachments.some((attachment) => attachment.filename === file.name)) ?? [];
  if (retainedFiles.length > 0 && previous?.userId !== selection.userId) {
    throw new Error('Sinopia account changed');
  }
  const files = [...new Map([...retainedFiles, ...selection.files].map((file) => [file.name, file])).values()];
  const measurements = [...(previous?.measurements ?? []), ...(selection.measurements ?? [])].filter((measurement) =>
    files.some((file) => file.name === measurement.filename),
  );
  return { ...selection, files, measurements };
}

/** Persist origin beside the existing per-device Home record; attachment bytes stay under their existing owner. */
export async function rememberSinopiaReferenceOrigin(
  client: AttachmentClient,
  selection: SinopiaReferenceSelection,
  directory = homeComposerScope().attachmentDirectory,
): Promise<void> {
  const originPath = sinopiaComposerOriginPath(directory);
  const current = await getSinopiaDataClient();
  if (current.userId !== selection.userId) {
    throw new Error('Sinopia account changed');
  }
  const origin = originSchema.parse({
    userId: selection.userId,
    projectId: selection.projectId,
    filenames: selection.files.map((file) => file.name),
    measurements: selection.measurements,
  });
  await client.writeFile(originPath, new TextEncoder().encode(JSON.stringify(origin)));
  const afterWrite = await getSinopiaDataClient();
  if (afterWrite.userId !== selection.userId) {
    throw new Error('Sinopia account changed');
  }
}

/** Recover a reload's origin from the Home record, restricted to image references still present in its draft. */
export async function restoreSinopiaReferenceSelection(
  client: AttachmentClient,
  attachments: readonly AttachmentReference[],
  directory?: string,
): Promise<SinopiaReferenceSelection | undefined> {
  const attachmentDirectory = directory ?? homeComposerScope().attachmentDirectory;
  const originPath = sinopiaComposerOriginPath(attachmentDirectory);
  if (!(await client.exists(originPath))) {
    return undefined;
  }
  const origin = originSchema.parse(JSON.parse(new TextDecoder().decode(await client.readFile(originPath))));
  const matches = attachments.filter(
    (attachment) =>
      attachment.mediaType.startsWith('image/') &&
      attachment.filename !== undefined &&
      origin.filenames.includes(attachment.filename),
  );
  if (matches.length === 0) {
    return undefined;
  }
  const current = await getSinopiaDataClient();
  if (current.userId !== origin.userId) {
    throw new Error('Sinopia account changed');
  }
  const store = createAttachmentStore(client, attachmentDirectory);
  const files: File[] = [];
  for (const attachment of matches) {
    // oxlint-disable-next-line no-await-in-loop -- keep reload copies within the same bounded image intake
    const bytes = await store.read(attachment);
    if (!bytes || !attachment.filename) {
      throw new Error('Sinopia reference missing');
    }
    files.push(new File([bytes], attachment.filename, { type: attachment.mediaType }));
  }
  return { userId: origin.userId, projectId: origin.projectId, files, measurements: origin.measurements };
}
