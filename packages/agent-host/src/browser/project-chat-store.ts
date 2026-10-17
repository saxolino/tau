// oxlint-disable-next-line import/no-cycle -- browser.ts exports project tasks but these functions are called after initialization.
import { createOpfsEventLog, createProviderAttachmentReader, createProviderEventLog } from '#browser.js';
import type { BrowserChatStoreOptions } from '#browser.js';
import { createChatStore, requireChatPathSegment } from '#launchers/chat-store.js';
import type { ChatStore } from '#launchers/chat-store.js';
import { chatLeadershipNames } from '#launchers/leadership/names.js';
import { createNodeLeadership } from '#launchers/node/node-leadership.js';
import type { EventLogAppender } from '#log/event-log-appender.js';
import { chatAttachmentPath } from '#harness/session-record.js';

const logPath = (chatId: string): string => `.tau/chats/${requireChatPathSegment(chatId)}/events.jsonl`;

const opfsFile = async (
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle | undefined> => {
  const segments = path.split('/');
  const name = segments.pop()!;
  try {
    let directory = root;
    for (const segment of segments) {
      // oxlint-disable-next-line no-await-in-loop -- each directory opens inside its parent.
      directory = await directory.getDirectoryHandle(segment, { create });
    }
    return await directory.getFileHandle(name, { create });
  } catch (error) {
    if (!create && error && typeof error === 'object' && 'name' in error && error.name === 'NotFoundError') {
      return undefined;
    }
    throw error;
  }
};

/** Acquire the same per-chat lock legacy M2 builds use; never steal it. */
const acquireChatLock = async (projectId: string, chatId: string): Promise<() => Promise<void>> => {
  const granted = Promise.withResolvers<(() => Promise<void>) | undefined>();
  const held = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const name = chatLeadershipNames(projectId, chatId).lock;
  // async-iife: bootstrap -- the Web Lock callback remains pending until the writer closes.
  void (async (): Promise<void> => {
    try {
      await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
        if (lock === null) {
          granted.resolve(undefined);
          return;
        }
        granted.resolve(async () => {
          held.resolve();
          await settled.promise;
        });
        await held.promise;
      });
    } catch (error) {
      granted.reject(error);
    } finally {
      settled.resolve();
    }
  })();
  const release = await granted.promise;
  if (release === undefined) {
    throw Object.assign(new Error(`Chat ${chatId} has an active writer in another tab.`), { code: 'WRITER_LOCKED' });
  }
  return release;
};

/** A chat store whose writes are subordinate to one project term. @internal */
export const createProjectOwnedBrowserChatStore = (
  projectId: string,
  options: BrowserChatStoreOptions,
  active: () => boolean,
): ChatStore => {
  const requireActive = (): void => {
    if (!active()) {
      throw Object.assign(new Error('The project owner lost its term.'), { code: 'LEADERSHIP_LOST' });
    }
  };
  const openWriter = async (chatId: string): Promise<EventLogAppender> => {
    requireActive();
    const release = await acquireChatLock(projectId, chatId);
    try {
      requireActive();
      let log: EventLogAppender;
      if (options.log.kind === 'opfs') {
        log = await createOpfsEventLog({
          fileHandle: (await opfsFile(options.log.directory, logPath(chatId), true))!,
          access: 'write',
        });
      } else {
        const { fileSystem } = options.log;
        const path = logPath(chatId);
        const marker = `${path}.lock`;
        if (await fileSystem.exists(marker)) {
          const bytes = await fileSystem.readFile(marker);
          const text = new TextDecoder().decode(bytes);
          // The Web Lock excludes old browser writers. Node's pid/path marker does not participate in that lock.
          if (!/^\d{13}\n$/.test(text)) {
            throw Object.assign(new Error(`Chat ${chatId} has an external writer marker.`), { code: 'WRITER_LOCKED' });
          }
          await fileSystem.unlink(marker);
        }
        log = await createProviderEventLog({
          fileSystem,
          filePath: path,
          access: 'write',
          lockName: `tau-log-append:${projectId}/${requireChatPathSegment(chatId)}`,
        });
      }
      let closed = false;
      return {
        ...log,
        append: async (event) => {
          requireActive();
          return log.append(event);
        },
        close: async () => {
          if (!closed) {
            await log.close();
            await release();
            closed = true;
          }
        },
      };
    } catch (error) {
      await release();
      throw error;
    }
  };
  const observeBytes =
    options.observeLog === undefined
      ? undefined
      : async (
          chatId: string,
          input: Readonly<{
            signal: AbortSignal;
            onChange: () => void;
            onError: (error: unknown) => void;
          }>,
        ) => options.observeLog!({ ...input, path: logPath(chatId) });

  if (options.log.kind === 'opfs') {
    const { directory } = options.log;
    const bytesOf = async (path: string): Promise<Uint8Array<ArrayBuffer> | undefined> => {
      const file = await opfsFile(directory, path, false);
      if (file === undefined) {
        return undefined;
      }
      const blob = await file.getFile();
      return new Uint8Array(await blob.arrayBuffer());
    };
    return createChatStore({
      platform: 'browser',
      observeBytes,
      durability: 'exclusive-append',
      attachments: { read: async (chatId, path) => bytesOf(chatAttachmentPath(chatId, path)) },
      readBytes: async (chatId) => (await bytesOf(logPath(chatId))) ?? new Uint8Array(),
      openWriter,
      leadership: createNodeLeadership,
    });
  }
  const { fileSystem } = options.log;
  return createChatStore({
    platform: 'browser',
    observeBytes,
    durability: options.log.durability ?? 'stream-append',
    attachments: createProviderAttachmentReader(fileSystem),
    readBytes: async (chatId) => {
      const path = logPath(chatId);
      return (await fileSystem.exists(path)) ? fileSystem.readFile(path) : new Uint8Array();
    },
    openWriter,
    leadership: createNodeLeadership,
  });
};
