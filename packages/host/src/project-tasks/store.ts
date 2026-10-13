import { z } from 'zod';
import { projectTaskSchema, projectTaskMessageSchema } from '@taucad/agent-host/wire';
import type { ProjectTask, ProjectTaskMessage, ProjectTaskRefusalCode } from '@taucad/agent-host/wire';

/** Typed task refusal preserves stable codes across tool/UI boundaries. @public */
export class ProjectTaskError extends Error {
  public readonly code: ProjectTaskRefusalCode;

  /** Construct a task refusal. @param code - Stable reason. @param message - Actionable detail. */
  public constructor(code: ProjectTaskRefusalCode, message: string) {
    super(message);
    this.name = 'ProjectTaskError';
    this.code = code;
  }
}

const requestSchema = z.strictObject({
  key: z.string().min(1),
  fingerprint: z.string().min(1),
  result: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('task'), task: projectTaskSchema }),
    z.strictObject({ kind: z.literal('message'), message: projectTaskMessageSchema }),
  ]),
});

/** Journal row is deliberately separate from canonical chat events. @internal */
export const projectTaskRecordSchema = z.strictObject({
  version: z.literal(1),
  projectId: z.string().min(1),
  sequence: z.number().int().positive(),
  tasks: z.array(projectTaskSchema),
  message: projectTaskMessageSchema.optional(),
  request: requestSchema.optional(),
  delivery: z
    .strictObject({ taskId: z.string().min(1), attemptId: z.string().min(1), through: z.number().int().nonnegative() })
    .optional(),
});

/** A project ordering authority's append. @public */
export type ProjectTaskRecord = z.infer<typeof projectTaskRecordSchema>;
/** A prepared change becomes visible only after append-and-sync acknowledges. @public */
export type ProjectTaskChange = Omit<ProjectTaskRecord, 'version' | 'projectId' | 'sequence'>;
/** Environment storage with owner-qualified exclusive append-and-sync. @public */
export type ProjectTaskStorage = Readonly<{
  read: () => Promise<Uint8Array<ArrayBuffer>>;
  append: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  truncate: (size: number) => Promise<void>;
  size: () => Promise<number>;
  exclusive: <Result>(section: () => Promise<Result>) => Promise<Result>;
  close: () => Promise<void>;
}>;
/** One serialized project writer; transaction callbacks must not acquire resources. @public */
export type ProjectTaskStore = Readonly<{
  projectId: string;
  transaction: <Result>(operation: (view: ProjectTaskStoreView) => Promise<Result>) => Promise<Result>;
  close: () => Promise<void>;
}>;
/** Current journal projection available inside the project writer's transaction. @public */
export type ProjectTaskStoreView = Readonly<{
  tasks: ReadonlyMap<string, ProjectTask>;
  messages: readonly ProjectTaskMessage[];
  requests: ReadonlyMap<string, z.infer<typeof requestSchema>>;
  deliveries: ReadonlyMap<string, number>;
  records: readonly ProjectTaskRecord[];
  sequence: number;
  append: (change: ProjectTaskChange) => Promise<ProjectTaskRecord>;
}>;

const encoder = new TextEncoder();

/**
 * Open a durable sidecar; complete invalid rows fail closed and torn final bytes are repaired on first append.
 *
 * @param options - Project identity and exclusively owned durable storage.
 * @returns The sole ordering authority for this project.
 * @public
 */
const openProjectTaskStore = async (
  options: Readonly<{ projectId: string; storage: ProjectTaskStorage }>,
): Promise<ProjectTaskStore> => {
  const { projectId, storage } = options;
  const tasks = new Map<string, ProjectTask>();
  const messages: ProjectTaskMessage[] = [];
  const requests = new Map<string, z.infer<typeof requestSchema>>();
  const deliveries = new Map<string, number>();
  const records: ProjectTaskRecord[] = [];
  let bytes = await storage.read();
  const lastNewline = bytes.lastIndexOf(10);
  let byteLength = lastNewline + 1;
  let tail = bytes.slice(byteLength);
  let poisoned = false;
  let closed = false;
  let queue = Promise.resolve();

  const apply = (record: ProjectTaskRecord): void => {
    for (const task of record.tasks) {
      tasks.set(task.id, task);
    }
    if (record.message) {
      messages.push(record.message);
    }
    if (record.request) {
      requests.set(record.request.key, record.request);
    }
    if (record.delivery) {
      deliveries.set(record.delivery.taskId, record.delivery.through);
    }
    records.push(record);
  };

  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, byteLength));
  try {
    for (const line of text.split('\n').filter(Boolean)) {
      const record = projectTaskRecordSchema.parse(JSON.parse(line));
      if (
        record.projectId !== projectId ||
        record.sequence !== records.length + 1 ||
        record.tasks.some((task) => task.projectId !== projectId) ||
        (record.message && (record.message.projectId !== projectId || record.message.sequence !== record.sequence))
      ) {
        throw new Error('Project identity or ordering does not match.');
      }
      apply(record);
    }
  } catch (error) {
    throw new ProjectTaskError('TASK_STORAGE_INVALID', `Task records cannot be replayed: ${String(error)}`);
  }
  bytes = bytes.slice(0, byteLength);

  const append = async (change: ProjectTaskChange): Promise<ProjectTaskRecord> => {
    const record = projectTaskRecordSchema.parse({ ...change, version: 1, projectId, sequence: records.length + 1 });
    if (
      record.tasks.some((task) => task.projectId !== projectId) ||
      (record.message && (record.message.projectId !== projectId || record.message.sequence !== record.sequence))
    ) {
      throw new ProjectTaskError('TASK_STORAGE_INVALID', 'A task append cannot change project identity or sequence.');
    }
    const serialized = encoder.encode(`${JSON.stringify(record)}\n`);
    await storage.exclusive(async () => {
      const disk = await storage.read();
      if (
        disk.byteLength !== byteLength + tail.byteLength ||
        !bytes.every((byte, index) => disk[index] === byte) ||
        !tail.every((byte, index) => disk[byteLength + index] === byte)
      ) {
        throw new ProjectTaskError('TASK_STORAGE_FENCED', 'The task journal changed outside its ordering authority.');
      }
      if (tail.byteLength > 0) {
        await storage.truncate(byteLength);
        tail = new Uint8Array();
      }
      try {
        await storage.append(serialized);
      } catch (error) {
        try {
          await storage.truncate(byteLength);
        } catch {
          poisoned = true;
          throw new ProjectTaskError(
            'TASK_STORAGE_POISONED',
            'Task append and rollback both failed; reopen after recovery.',
          );
        }
        throw error;
      }
    });
    const previous = bytes;
    bytes = new Uint8Array(previous.byteLength + serialized.byteLength);
    bytes.set(previous);
    bytes.set(serialized, previous.byteLength);
    byteLength += serialized.byteLength;
    apply(record);
    return record;
  };

  const transaction = async <Result>(operation: (view: ProjectTaskStoreView) => Promise<Result>): Promise<Result> => {
    const prior = queue;
    const next = Promise.withResolvers<void>();
    queue = next.promise;
    await prior;
    try {
      if (closed || poisoned) {
        throw new ProjectTaskError(closed ? 'TASK_CLOSED' : 'TASK_STORAGE_POISONED', 'The task store is unavailable.');
      }
      return await operation({ tasks, messages, requests, deliveries, records, sequence: records.length, append });
    } finally {
      next.resolve();
    }
  };

  return {
    projectId,
    transaction,
    close: async () => {
      await queue;
      if (!closed) {
        closed = true;
        await storage.close();
      }
    },
  };
};

/**
 * Open task storage and release authority on every initialization failure, including malformed bytes.
 *
 * @param options - Project identity and exclusively owned append-and-sync storage.
 * @returns The project ordering authority.
 * @public
 */
export const createProjectTaskStore = async (
  options: Readonly<{ projectId: string; storage: ProjectTaskStorage }>,
): Promise<ProjectTaskStore> => {
  try {
    return await openProjectTaskStore(options);
  } catch (error) {
    try {
      await options.storage.close();
    } catch (closeError) {
      throw new AggregateError([error, closeError], 'Task storage initialization and authority release failed.');
    }
    throw error;
  }
};
