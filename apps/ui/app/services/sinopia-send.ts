import { z } from 'zod';
import { randomUuid } from '@taucad/utils/id';
import type { ExportFile } from '@taucad/types';
import { getSinopiaDataClient } from '#lib/sinopia-data-client.js';
import { ensureSinopiaCadModel, getSinopiaCadModel } from '#services/sinopia-cad.js';
import type { SinopiaCadEngine, SinopiaCadLink, SinopiaCadModel } from '#services/sinopia-cad.js';
import type { prepareSinopiaFiles } from '#services/project-export.js';
import { isNotFound } from '#db/attachment-store.js';

export type SinopiaSendFormat = 'step' | 'glb' | 'photo' | 'pdf';
export type SinopiaSendFiles = Awaited<ReturnType<typeof prepareSinopiaFiles>>;
export type SinopiaSendReceipt = Readonly<{
  assetId: string;
  projectId: string;
  modelId: string;
  userId: string;
  versionNumber: number;
  createdAt: number;
}>;
export type SinopiaSendProblem =
  | 'migration'
  | 'session'
  | 'destination'
  | 'files'
  | 'failed'
  | 'history'
  | 'model'
  | 'version';
export type SinopiaDeliveryEvent = Readonly<{ kind: 'sent'; id: string; createdAt: number; versionNumber: number }>;
type SinopiaSendRecordFiles = {
  readFile(path: string): Promise<Uint8Array<ArrayBuffer>>;
  writeFile(path: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  readdir(path: string): Promise<string[]>;
};
type ReceiptQuery = { link: SinopiaCadLink; projectId: string; assetId: string; signal?: AbortSignal };
/** What each delivered piece is made of and how (E3a): Sinopia reads it with the CAD model's version. */
export type SinopiaSendPiece = Readonly<{
  nome: string;
  materiale?: Readonly<{ chiave: string; nome: string }>;
  processo?: string;
  pesoGrammi?: number;
  volumeMm3?: number;
}>;
type SinopiaSendRequest = {
  link: SinopiaCadLink;
  projectId: string;
  prepared: SinopiaSendFiles;
  selected: readonly SinopiaSendFormat[];
  note: string;
  signal: AbortSignal;
  deliveryId: string;
  /** Material, process and weight of each piece; absent for a model without them. */
  pieces?: readonly SinopiaSendPiece[];
  /** The model's own preview in the same project, used as the version's thumbnail when no photo is sent. */
  fallbackThumbnailPath?: string;
  /** What registers the model's `cad_models` row when it has none yet: its name and engine. */
  model: SinopiaSendModel;
  /**
   * The number the prepared files name (the PDF sheet's «v<n>»). A number another send took meanwhile fails with
   * `version`, so the caller prepares again, instead of the sheet saying one number and the version another.
   */
  versionNumber?: number;
  /**
   * `sinopiaCadContentKey` of the files the sent model was rendered from, when they are all in a revision: the sample
   * photo then knows the model on screen is still this version by its content, not by guessing from the shape.
   */
  contentKey?: string;
};
/** The model as the send registers it: the engine is `undefined` when the CAD cannot tell it. */
export type SinopiaSendModel = Readonly<{ name: string; engine: SinopiaCadEngine | undefined }>;
/** The model's row, registered first when it has none; a model whose engine is unknown can only be read. */
type EnsureModel = (link: SinopiaCadLink, model: SinopiaSendModel) => Promise<SinopiaCadModel>;
type SinopiaSender = {
  nextVersion(link: SinopiaCadLink, projectId: string, signal?: AbortSignal): Promise<number>;
  receipt(input: ReceiptQuery): Promise<SinopiaSendReceipt | undefined>;
  projects(userId: string, signal?: AbortSignal): Promise<Array<{ id: string; name: string }>>;
  send(input: SinopiaSendRequest): Promise<SinopiaSendReceipt>;
};

/** A user-facing failure category; raw service messages never enter the dialog. */
export class SinopiaSendError extends Error {
  public readonly problem: SinopiaSendProblem;
  public constructor(problem: SinopiaSendProblem) {
    super(`Sinopia delivery: ${problem}`);
    this.name = 'SinopiaSendError';
    this.problem = problem;
  }
}

const projectSchema = z.object({ id: z.uuid(), name: z.string() });
/* eslint-disable @typescript-eslint/naming-convention -- These validation objects describe Supabase wire column names verbatim. */
const versionSchema = z.object({ version_number: z.number().int().positive().nullable() });
const uuid = z.uuid();
const bucket = 'creator-private';
const receiptSchema = z.object({
  version_number: z.number().int().positive(),
  created_at: z.iso.datetime({ offset: true }),
});
/* eslint-enable @typescript-eslint/naming-convention -- Domain interfaces and implementations use camelCase outside wire projections. */

const migrationMissing = (error: { code?: string; message?: string }): boolean =>
  error.code === '23514' && /assets_type_check/u.test(error.message ?? '');

/** The file name of each delivered format inside the version's folder. */
export const deliveryFileName = (format: SinopiaSendFormat): string =>
  format === 'photo' ? 'preview.png' : format === 'pdf' ? 'tavola.pdf' : `model.${format}`;

/** Only the model's own preview inside the destination project may stand in for the photo. */
export function sameProjectThumbnail(path: string | undefined, projectId: string, modelId: string): string | undefined {
  if (!path?.startsWith(`projects/${projectId}/cad/${modelId}/`)) {
    return undefined;
  }
  return path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')
    ? undefined
    : path;
}

/** The pieces as the asset's metadata stores them (`metadata.pezzi`): snake_case keys, rounded numbers. */
export function deliveryPieces(pieces: readonly SinopiaSendPiece[]): Array<Record<string, string | number>> {
  /* eslint-disable @typescript-eslint/naming-convention -- Persisted Sinopia metadata keys. */
  return pieces.slice(0, 200).map((piece) => ({
    nome: piece.nome.slice(0, 200),
    ...(piece.materiale ? { materiale: piece.materiale.chiave, materiale_nome: piece.materiale.nome } : {}),
    ...(piece.processo === undefined ? {} : { processo: piece.processo }),
    ...(piece.pesoGrammi === undefined ? {} : { peso_g: Math.round(piece.pesoGrammi * 100) / 100 }),
    ...(piece.volumeMm3 === undefined ? {} : { volume_mm3: Math.round(piece.volumeMm3 * 1000) / 1000 }),
  }));
  /* eslint-enable @typescript-eslint/naming-convention -- Back to the domain's camelCase names. */
}

/** Validate selected results at the delivery boundary, including exact STEP verification. */
export function selectedSinopiaFiles(
  prepared: SinopiaSendFiles,
  selected: readonly SinopiaSendFormat[],
): Array<{
  format: SinopiaSendFormat;
  file: ExportFile;
}> {
  if (selected.length === 0 || new Set(selected).size !== selected.length) {
    throw new SinopiaSendError('files');
  }
  return selected.map((format) => {
    const result = prepared[format];
    const file = result.files?.[0];
    if (
      result.status === 'needsFix' ||
      (format === 'step' && result.status !== 'verified') ||
      result.files.length !== 1 ||
      !file ||
      file.bytes.length === 0 ||
      (format === 'glb' && file.mimeType !== 'model/gltf-binary') ||
      (format === 'photo' && file.mimeType !== 'image/png') ||
      (format === 'pdf' && file.mimeType !== 'application/pdf')
    ) {
      throw new SinopiaSendError('files');
    }
    return { format, file };
  });
}

/** The model's row before any version of it: the existing one, or the one its first send registers. */
async function ensureSentModel(link: SinopiaCadLink, model: SinopiaSendModel): Promise<SinopiaCadModel> {
  if (model.engine !== undefined) {
    return ensureSinopiaCadModel(link, model.name, model.engine);
  }
  const existing = await getSinopiaCadModel(link);
  if (existing === undefined) {
    throw new SinopiaSendError('model');
  }
  return existing;
}

/** The delivery uses the admitted user's JWT and explicit ownership filters at every read. */
export function createSinopiaSender(
  getClient = getSinopiaDataClient,
  ensureModel: EnsureModel = ensureSentModel,
): SinopiaSender {
  const admitted = async (userId: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    let session: Awaited<ReturnType<typeof getClient>>;
    try {
      session = await getClient();
    } catch {
      throw new SinopiaSendError('session');
    }
    signal?.throwIfAborted();
    if (session.userId !== userId) {
      throw new SinopiaSendError('session');
    }
    return session.client;
  };

  const nextVersion = async (link: SinopiaCadLink, projectId: string, signal?: AbortSignal): Promise<number> => {
    const client = await admitted(link.userId, signal);
    const { data, error } = await client
      .from('assets')
      .select('version_number')
      .eq('user_id', link.userId)
      .eq('project_id', projectId)
      .eq('type', 'cad_model')
      // eslint-disable-next-line @typescript-eslint/naming-convention -- This containment predicate uses the persisted Supabase JSON field.
      .contains('metadata', { cad_model_id: link.modelId })
      .order('version_number', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    await admitted(link.userId, signal);
    if (error) {
      throw new SinopiaSendError(migrationMissing(error) ? 'migration' : 'failed');
    }
    const row = data === null ? undefined : versionSchema.parse(data);
    return (row?.version_number ?? 0) + 1;
  };

  const reconcile = async ({
    link,
    projectId,
    assetId,
    signal,
  }: ReceiptQuery): Promise<SinopiaSendReceipt | undefined> => {
    const client = await admitted(link.userId, signal);
    const { data, error } = await client
      .from('assets')
      .select('version_number,created_at')
      .eq('id', assetId)
      .eq('user_id', link.userId)
      .eq('project_id', projectId)
      .eq('type', 'cad_model')
      // eslint-disable-next-line @typescript-eslint/naming-convention -- This containment predicate uses the persisted Supabase JSON field.
      .contains('metadata', { cad_model_id: link.modelId })
      .maybeSingle();
    await admitted(link.userId, signal);
    if (error) {
      throw new SinopiaSendError('failed');
    }
    if (data === null) {
      return undefined;
    }
    const row = receiptSchema.parse(data);
    return {
      assetId,
      projectId,
      modelId: link.modelId,
      userId: link.userId,
      versionNumber: row.version_number,
      createdAt: Date.parse(row.created_at),
    };
  };

  /**
   * Only the newest version of a model is current: every older one of the same model in the project goes to
   * `is_current: false`. Lowering only the numbers BELOW this one keeps two sends racing safe (the newer always stays
   * current, whichever ends last) and makes it repeatable: a failure here leaves the version sent, and the next send
   * (or the resume of this one) lowers them again.
   */
  const retireOlderVersions = async ({
    link,
    projectId,
    assetId,
    versionNumber,
  }: Readonly<{ link: SinopiaCadLink; projectId: string; assetId: string; versionNumber: number }>): Promise<void> => {
    try {
      const client = await admitted(link.userId);
      const { error } = await client
        .from('assets')
        // eslint-disable-next-line @typescript-eslint/naming-convention -- Supabase asset wire column.
        .update({ is_current: false })
        .eq('user_id', link.userId)
        .eq('project_id', projectId)
        .eq('type', 'cad_model')
        // eslint-disable-next-line @typescript-eslint/naming-convention -- This containment predicate uses the persisted Supabase JSON field.
        .contains('metadata', { cad_model_id: link.modelId })
        .neq('id', assetId)
        .lt('version_number', versionNumber)
        .eq('is_current', true);
      if (error !== null) {
        console.error('[sinopia-send] the older versions are still marked current', error);
      }
    } catch (error) {
      console.error('[sinopia-send] the older versions are still marked current', error);
    }
  };

  return {
    nextVersion,
    receipt: reconcile,
    async projects(userId: string, signal?: AbortSignal): Promise<Array<z.infer<typeof projectSchema>>> {
      const client = await admitted(userId, signal);
      const { data, error } = await client
        .from('projects')
        .select('id,name')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });
      await admitted(userId, signal);
      if (error) {
        throw new SinopiaSendError('failed');
      }
      return z.array(projectSchema).parse(data);
    },
    async send({
      link,
      projectId,
      prepared,
      selected,
      note,
      signal,
      deliveryId,
      pieces,
      fallbackThumbnailPath,
      model,
      versionNumber: pinned,
      contentKey,
    }: SinopiaSendRequest): Promise<SinopiaSendReceipt> {
      if (![link.modelId, projectId, link.userId, deliveryId].every((id) => uuid.safeParse(id).success)) {
        throw new SinopiaSendError('destination');
      }
      const previous = await reconcile({ link, projectId, assetId: deliveryId, signal });
      if (previous) {
        await retireOlderVersions({
          link,
          projectId,
          assetId: previous.assetId,
          versionNumber: previous.versionNumber,
        });
        return previous;
      }
      // One project per model: a version sent into any other project would point at a model that is not there.
      if (projectId !== link.projectId) {
        throw new SinopiaSendError('destination');
      }
      const files = selectedSinopiaFiles(prepared, selected);
      // The model's row comes first (a model never saved yet has none): a version never names a missing model.
      let registered: SinopiaCadModel;
      try {
        registered = await ensureModel(link, model);
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof SinopiaSendError) {
          throw error;
        }
        console.error('[sinopia-send] the model could not be registered before its version', error);
        throw new SinopiaSendError('model');
      }
      const client = await admitted(link.userId, signal);
      const destination = await client
        .from('projects')
        .select('id')
        .eq('id', projectId)
        .eq('user_id', link.userId)
        .is('deleted_at', null)
        .maybeSingle();
      await admitted(link.userId, signal);
      if (destination.error !== null || destination.data === null) {
        throw new SinopiaSendError('destination');
      }
      // A unique index arbitrates the number. Attempts use separate paths, so the loser can only delete its own files.
      for (let attempt = 0; attempt < 4; attempt++) {
        // oxlint-disable-next-line no-await-in-loop -- A conflict must read the winner's number before trying the next one.
        const versionNumber = await nextVersion(link, projectId, signal);
        if (pinned !== undefined && versionNumber !== pinned) {
          // The files name another number (the PDF sheet): prepare again rather than send a sheet that lies.
          throw new SinopiaSendError('version');
        }
        const assetId = deliveryId;
        const prefix = `projects/${projectId}/cad/${link.modelId}/v${versionNumber}/${randomUuid()}`;
        const uploaded: string[] = [];
        let isCommitted = false;
        const entries = files.map(({ format, file }) => ({
          format,
          file,
          path: `${prefix}/${deliveryFileName(format)}`,
        }));
        // Every version has a thumbnail (E3a): the photo sent, else the model's own preview in this project, else the
        // view captured for this send (a model whose preview is not on Sinopia yet), stored beside the version.
        const photo = entries.find((entry) => entry.format === 'photo')?.path;
        const preview = sameProjectThumbnail(
          fallbackThumbnailPath ?? registered.thumbnail_path ?? undefined,
          projectId,
          link.modelId,
        );
        const captured = prepared.photo.status === 'needsFix' ? undefined : prepared.photo.files[0];
        const extraThumbnail =
          photo === undefined &&
          preview === undefined &&
          captured?.mimeType === 'image/png' &&
          captured.bytes.length > 0
            ? { file: captured, path: `${prefix}/thumbnail.png` }
            : undefined;
        try {
          for (const entry of [...entries, ...(extraThumbnail ? [extraThumbnail] : [])]) {
            // oxlint-disable-next-line no-await-in-loop -- Bound uploads and recheck identity before every mutation.
            const current = await admitted(link.userId, signal);
            // oxlint-disable-next-line no-await-in-loop -- Serial upload gives cleanup an exact list of completed writes.
            const { error } = await current.storage.from(bucket).upload(entry.path, entry.file.bytes, {
              contentType: entry.file.mimeType,
              upsert: false,
            });
            if (error) {
              throw new SinopiaSendError('failed');
            }
            uploaded.push(entry.path);
          }
          // oxlint-disable-next-line no-await-in-loop -- Identity may have changed during the final upload.
          const current = await admitted(link.userId, signal);
          const createdAt = Date.now();
          const primary = entries.find((entry) => entry.format === 'glb') ?? entries[0]!;
          // Until the acknowledgement or reconciliation arrives, the row may already reference these artifacts.
          isCommitted = true;
          /* eslint-disable @typescript-eslint/naming-convention -- This insert serializes actual Supabase columns and the established private-artifact metadata schema. */
          // oxlint-disable-next-line no-await-in-loop -- The insert resolves the unique-version race for this attempt.
          const { error } = await current.from('assets').insert({
            id: assetId,
            project_id: projectId,
            user_id: link.userId,
            type: 'cad_model',
            version_number: versionNumber,
            storage_bucket: bucket,
            storage_path: primary.path,
            public_url: null,
            size_bytes: entries.reduce((sum, entry) => sum + entry.file.bytes.length, 0),
            is_current: true,
            created_at: new Date(createdAt).toISOString(),
            metadata: {
              cad_model_id: link.modelId,
              source: 'sinopiacad',
              note: note.trim().slice(0, 2000) || null,
              ai_generated: true,
              aiAct: {
                label: 'ai-generated',
                reason: 'Created with AI in SinopiaCAD',
                needsHumanReview: false,
                rulesVersion: 'sinopiacad-2026-10-23',
                recordedAt: new Date(createdAt).toISOString(),
                source: 'client',
                operation: 'sinopiacad',
                provenance: 'generated',
              },
              files: entries.map((entry) => ({
                format: entry.format,
                storage_path: entry.path,
                mime_type: entry.file.mimeType,
                size_bytes: entry.file.bytes.length,
              })),
              thumbnail_path: photo ?? preview ?? extraThumbnail?.path ?? null,
              ...(pieces && pieces.length > 0 ? { pezzi: deliveryPieces(pieces) } : {}),
              ...(contentKey !== undefined && /^[0-9a-f]{64}$/u.test(contentKey) ? { content_key: contentKey } : {}),
              // The image (and part) of the project the model was built from: Sinopia shows it beside the version.
              ...(link.sourceAssetId !== undefined && projectId === link.projectId
                ? { source_asset_id: link.sourceAssetId, source_part_id: link.sourcePartId ?? null }
                : {}),
            },
          });
          /* eslint-enable @typescript-eslint/naming-convention -- The remaining delivery lifecycle uses domain camelCase names. */
          if (error) {
            if (error.code === '23514' || error.code === '23505') {
              isCommitted = false;
            }
            if (error.code !== '23514' && error.code !== '23505') {
              // A lost insert acknowledgement is ambiguous. Keep the artifacts until an owned-row read resolves it.
              isCommitted = true;
              // oxlint-disable-next-line no-await-in-loop -- Reconcile this stable send identity before permitting a retry.
              const saved = await reconcile({ link, projectId, assetId, signal });
              if (saved) {
                return saved;
              }
              isCommitted = false;
            }
            if (error.code === '23505') {
              // oxlint-disable-next-line no-await-in-loop -- A concurrent retry of this same send can win the primary key.
              const saved = await reconcile({ link, projectId, assetId, signal });
              if (saved) {
                return saved;
              }
              if (pinned !== undefined) {
                // Another send took the pinned number: this attempt's files go, the caller prepares again.
                throw new SinopiaSendError('version');
              }
              continue;
            }
            throw new SinopiaSendError(migrationMissing(error) ? 'migration' : 'failed');
          }
          isCommitted = true;
          // oxlint-disable-next-line no-await-in-loop -- Never present the previous user's completed delivery after a switch.
          await admitted(link.userId, signal);
          // oxlint-disable-next-line no-await-in-loop -- The older versions stop being current once this one exists.
          await retireOlderVersions({ link, projectId, assetId, versionNumber });
          return { assetId, projectId, modelId: link.modelId, userId: link.userId, versionNumber, createdAt };
        } finally {
          if (!isCommitted && uploaded.length > 0) {
            try {
              // oxlint-disable-next-line no-await-in-loop -- Cleanup belongs only to this failed attempt and its admitted owner.
              const current = await admitted(link.userId);
              // oxlint-disable-next-line no-await-in-loop -- Finish cleanup before allocating another version.
              const result = await current.storage.from(bucket).remove(uploaded);
              if (result.error) {
                console.error('[sinopia-send] could not remove unused delivery files', result.error);
              }
            } catch (error) {
              console.error('[sinopia-send] unused delivery files need cleanup', error);
            }
          }
        }
      }
      throw new SinopiaSendError('failed');
    },
  };
}

export const sinopiaSender = createSinopiaSender();
export const sinopiaSentDirectory = (projectId: string): string => `/projects/${projectId}/.tau/sinopia-sent`;
export const sinopiaPendingDirectory = (projectId: string): string =>
  `/projects/${projectId}/.tau/sinopia-send-pending`;
export const sinopiaPendingPath = (projectId: string, deliveryId: string): string =>
  `${sinopiaPendingDirectory(projectId)}/${deliveryId}.json`;
const pendingSchema = z.object({
  deliveryId: z.uuid(),
  projectId: z.uuid(),
  modelId: z.uuid(),
  userId: z.uuid(),
  selected: z.array(z.enum(['step', 'glb', 'photo', 'pdf'])).min(1),
  note: z.string().max(2000),
});
export type PendingSinopiaDelivery = z.infer<typeof pendingSchema>;

/** Keep the stable send identity across dialog dismissal, a reload or a lost acknowledgement. */
export async function readPendingSinopiaDelivery(
  files: Pick<SinopiaSendRecordFiles, 'readFile' | 'readdir'>,
  localProjectId: string,
  link: SinopiaCadLink,
): Promise<PendingSinopiaDelivery | undefined> {
  let names: string[];
  try {
    names = await files.readdir(sinopiaPendingDirectory(localProjectId));
  } catch (error) {
    if (isNotFound(error)) {
      return undefined;
    }
    throw error;
  }
  const name = names.filter((value) => /^[0-9a-f-]{36}\.json$/u.test(value)).sort()[0];
  if (name === undefined) {
    return undefined;
  }
  const bytes = await files.readFile(`${sinopiaPendingDirectory(localProjectId)}/${name}`);
  const pending = pendingSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (pending.modelId !== link.modelId || pending.userId !== link.userId) {
    throw new SinopiaSendError('session');
  }
  return pending;
}

/** Persist the intent before the first remote mutation; never replace an uncertain intent with a new send identity. */
export async function writePendingSinopiaDelivery(
  files: Pick<SinopiaSendRecordFiles, 'writeFile'>,
  localProjectId: string,
  pending: PendingSinopiaDelivery,
): Promise<void> {
  await files.writeFile(
    sinopiaPendingPath(localProjectId, pending.deliveryId),
    new TextEncoder().encode(JSON.stringify(pendingSchema.parse(pending))),
  );
}
const eventSchema = z.object({
  kind: z.literal('sent'),
  id: z.uuid(),
  createdAt: z.number().nonnegative(),
  versionNumber: z.number().int().positive(),
});

/** One immutable record per delivery avoids lost updates between two sends or tabs. */
export async function recordSinopiaDelivery(
  files: Pick<SinopiaSendRecordFiles, 'writeFile'>,
  projectId: string,
  receipt: SinopiaSendReceipt,
): Promise<void> {
  const event: SinopiaDeliveryEvent = {
    kind: 'sent',
    id: receipt.assetId,
    createdAt: receipt.createdAt,
    versionNumber: receipt.versionNumber,
  };
  await files.writeFile(
    `${sinopiaSentDirectory(projectId)}/${receipt.assetId}.json`,
    new TextEncoder().encode(JSON.stringify(event)),
  );
}

/** Read actual delivery records, never fabricate a revision for an export. */
export async function readSinopiaDeliveries(
  files: Pick<SinopiaSendRecordFiles, 'readFile' | 'readdir'>,
  projectId: string,
): Promise<SinopiaDeliveryEvent[]> {
  const directory = sinopiaSentDirectory(projectId);
  let names: string[];
  try {
    names = await files.readdir(directory);
  } catch (error) {
    if (isNotFound(error)) {
      return [];
    }
    throw error;
  }
  const events = await Promise.all(
    names
      .filter((name) => /^[0-9a-f-]{36}\.json$/u.test(name))
      .map(async (name) => {
        const bytes = await files.readFile(`${directory}/${name}`);
        return eventSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      }),
  );
  return events.sort((left, right) => right.createdAt - left.createdAt);
}
