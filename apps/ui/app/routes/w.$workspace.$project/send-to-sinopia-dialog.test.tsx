import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportFile } from '@taucad/types/constants';
import { setLanguage } from '#i18n/language.js';
import { bindTranslate } from '#i18n/translate.js';
import type { Language } from '#i18n/language.js';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';
import type { SinopiaSendFiles, SinopiaSendReceipt } from '#services/sinopia-send.js';
import { sinopiaSender, SinopiaSendError } from '#services/sinopia-send.js';
import { toast } from '#components/ui/sonner.js';
import { SendToSinopiaDialog } from '#routes/w.$workspace.$project/send-to-sinopia-dialog.js';

const hooks = vi.hoisted(() => ({
  prepare: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn(),
  currentUser: '10000000-0000-4000-8000-000000000001',
}));
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'local' }) }));
vi.mock('#hooks/use-file-manager.js', () => ({
  useFileManager: () => ({
    recordFiles: { readFile: hooks.read, writeFile: hooks.write, readdir: hooks.readdir, unlink: hooks.unlink },
  }),
}));
vi.mock('#hooks/use-project-export.js', () => ({ useProjectExport: () => ({ prepareSinopia: hooks.prepare }) }));
vi.mock('#lib/sinopia-data-client.js', () => ({ getSinopiaDataClient: async () => ({ userId: hooks.currentUser }) }));
vi.mock('#components/ui/sonner.js', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const owner = '10000000-0000-4000-8000-000000000001';
const projectId = '20000000-0000-4000-8000-000000000001';
const alternative = '20000000-0000-4000-8000-000000000002';
const link: SinopiaCadLink = {
  modelId: '30000000-0000-4000-8000-000000000001',
  projectId,
  userId: owner,
  baseRevisionId: null,
};
const prepared: SinopiaSendFiles = {
  step: { status: 'verified', files: [createExportFile('step', 'model', new Uint8Array([1]))] },
  glb: { status: 'ready', files: [createExportFile('glb', 'model', new Uint8Array([2]))] },
  photo: { status: 'ready', files: [createExportFile('png', 'preview', new Uint8Array([3]))] },
};
const stored = new Map<string, Uint8Array<ArrayBuffer>>();
let saved: SinopiaSendReceipt | undefined;
const clients: QueryClient[] = [];
function mount(onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return {
    ...render(
      <QueryClientProvider client={client}>
        <SendToSinopiaDialog isOpen link={link} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    ),
    onOpenChange,
  };
}
beforeEach(() => {
  hooks.currentUser = owner;
  stored.clear();
  saved = undefined;
  hooks.prepare.mockResolvedValue(prepared);
  hooks.read.mockImplementation(async (path: string) => {
    const bytes = stored.get(path);
    if (!bytes) {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }
    return bytes;
  });
  hooks.write.mockImplementation(async (path: string, bytes: Uint8Array<ArrayBuffer>) => {
    stored.set(path, bytes);
  });
  hooks.readdir.mockImplementation(async (path: string) =>
    [...stored.keys()].filter((name) => name.startsWith(`${path}/`)).map((name) => name.slice(path.length + 1)),
  );
  hooks.unlink.mockImplementation(async (path: string) => {
    stored.delete(path);
  });
  vi.spyOn(sinopiaSender, 'projects').mockResolvedValue([
    { id: projectId, name: 'Collana' },
    { id: alternative, name: 'Primavera' },
  ]);
  vi.spyOn(sinopiaSender, 'nextVersion').mockResolvedValue(3);
  vi.spyOn(sinopiaSender, 'receipt').mockImplementation(async () => saved);
  vi.spyOn(sinopiaSender, 'send').mockImplementation(async (input) => {
    saved = {
      assetId: input.deliveryId,
      projectId: input.projectId,
      modelId: link.modelId,
      userId: owner,
      versionNumber: 3,
      createdAt: Date.now(),
    };
    return saved;
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) {
    client.clear();
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe.each<Language>(['it', 'en'])('Sinopia send dialog in %s', (language) => {
  it('should offer to create the Sinopia project of an unlinked model instead of a dead end', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    const start = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const dialog = (state: 'linking' | 'failed' | undefined, linked?: SinopiaCadLink) => (
      <QueryClientProvider client={client}>
        <SendToSinopiaDialog
          isOpen
          link={linked}
          linking={{ name: 'Collana col ramo', state, start }}
          onOpenChange={vi.fn()}
        />
      </QueryClientProvider>
    );
    const view = render(dialog(undefined));
    expect(screen.getByText(t('sinopiaSend.unlinked'))).toBeInTheDocument();
    expect(screen.queryByText(/Chiudi la finestra|Close this dialog/u)).not.toBeInTheDocument();
    const create = screen.getByRole('button', { name: t('sinopiaSend.createProject', { name: 'Collana col ramo' }) });
    expect(create).toHaveTextContent(
      language === 'it' ? 'Crea il progetto «Collana col ramo» su Sinopia' : 'Collana col ramo',
    );
    await user.click(create);
    expect(start).toHaveBeenCalledOnce();
    view.rerender(dialog('linking'));
    expect(screen.getByRole('status')).toHaveTextContent(t('sinopiaSend.creating'));
    expect(
      screen.getByRole('button', { name: t('sinopiaSend.createProject', { name: 'Collana col ramo' }) }),
    ).toBeDisabled();
    view.rerender(dialog('failed'));
    expect(screen.getByRole('alert')).toHaveTextContent(t('sinopiaSend.createFailed'));
    await user.click(
      screen.getByRole('button', { name: t('sinopiaSend.createProject', { name: 'Collana col ramo' }) }),
    );
    expect(start).toHaveBeenCalledTimes(2);
    view.rerender(dialog(undefined, link));
    expect(await screen.findByRole('checkbox', { name: t('sinopiaSend.step') })).toBeChecked();
  });

  it('should offer checked formats, own destination changes and a note, then record the actual delivered version', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    const view = mount();
    expect(await screen.findByRole('checkbox', { name: t('sinopiaSend.step') })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: t('sinopiaSend.glb') })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: t('sinopiaSend.photo') })).toBeChecked();
    await user.click(await screen.findByRole('button', { name: t('sinopiaSend.change') }));
    await user.selectOptions(screen.getByRole('combobox', { name: t('sinopiaSend.chooseProject') }), alternative);
    await user.type(screen.getByRole('textbox', { name: t('sinopiaSend.note') }), 'Marquise 12 × 5');
    await user.click(await screen.findByRole('button', { name: t('sinopiaSend.send', { number: 3 }) }));
    await waitFor(() => {
      expect(view.onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(sinopiaSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: alternative, selected: ['step', 'glb', 'photo'], note: 'Marquise 12 × 5' }),
    );
    expect(toast.success).toHaveBeenCalledOnce();
    const [message, options] = vi.mocked(toast.success).mock.calls[0]!;
    expect(message).toBe(t('sinopiaSend.sent', { number: 3 }));
    expect(options?.action).toMatchObject({ label: t('sinopiaSend.openProject') });
    expect([...stored.keys()].filter((path) => path.includes('/sinopia-sent/'))).toHaveLength(1);
    expect([...stored.keys()].filter((path) => path.includes('/sinopia-send-pending/'))).toEqual([]);
  });

  it('should show the explicit missing migration error without announcing success', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    vi.mocked(sinopiaSender.send).mockRejectedValue(new SinopiaSendError('migration'));
    const user = userEvent.setup();
    const view = mount();
    await user.click(await screen.findByRole('button', { name: t('sinopiaSend.send', { number: 3 }) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('sinopiaSend.errors.migration'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(view.onOpenChange).not.toHaveBeenCalled();
  });
});

describe('Sinopia delivery recovery', () => {
  it('should report an unavailable requested format and let the user send only the ready formats', async () => {
    setLanguage('en');
    hooks.prepare.mockResolvedValue({ ...prepared, step: { status: 'needsFix', problem: 'independent' } });
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Send version 3' }));
    expect(await screen.findByText(/Independent checking is unavailable/u)).toBeInTheDocument();
    expect(sinopiaSender.send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: 'STEP for production' }));
    await user.click(screen.getByRole('button', { name: 'Send version 3' }));
    await waitFor(() => {
      expect(sinopiaSender.send).toHaveBeenCalledWith(expect.objectContaining({ selected: ['glb', 'photo'] }));
    });
  });

  it('should recover a committed send after history failure and dialog unmount without sending another version', async () => {
    setLanguage('en');
    const user = userEvent.setup();
    const originalWrite = hooks.write.getMockImplementation()!;
    hooks.write.mockImplementation(async (path: string, bytes: Uint8Array<ArrayBuffer>) => {
      if (path.includes('/sinopia-sent/')) {
        throw new Error('record unavailable');
      }
      await originalWrite(path, bytes);
    });
    const first = mount();
    await user.click(await screen.findByRole('button', { name: 'Send version 3' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The version is on Sinopia');
    expect(toast.success).not.toHaveBeenCalled();
    expect(first.onOpenChange).not.toHaveBeenCalled();
    expect([...stored.keys()].filter((path) => path.includes('/sinopia-send-pending/'))).toHaveLength(1);
    first.unmount();
    hooks.write.mockImplementation(originalWrite);
    hooks.prepare.mockClear();
    const second = mount();
    await user.click(await screen.findByRole('button', { name: 'Check and complete delivery' }));
    await waitFor(() => {
      expect(second.onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(sinopiaSender.send).toHaveBeenCalledOnce();
    expect(hooks.prepare).not.toHaveBeenCalled();
    expect([...stored.keys()].filter((path) => path.includes('/sinopia-sent/'))).toHaveLength(1);
    expect([...stored.keys()].filter((path) => path.includes('/sinopia-send-pending/'))).toEqual([]);
  });

  it('should preserve a pending identity and withhold history and success when the account changes at commit', async () => {
    setLanguage('en');
    const user = userEvent.setup();
    vi.mocked(sinopiaSender.send).mockImplementation(async (input) => {
      hooks.currentUser = '10000000-0000-4000-8000-000000000002';
      return {
        assetId: input.deliveryId,
        projectId,
        modelId: link.modelId,
        userId: owner,
        versionNumber: 3,
        createdAt: Date.now(),
      };
    });
    const view = mount();
    await user.click(await screen.findByRole('button', { name: 'Send version 3' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The account changed');
    expect(toast.success).not.toHaveBeenCalled();
    expect(view.onOpenChange).not.toHaveBeenCalled();
    expect([...stored.keys()].filter((path) => path.includes('/sinopia-sent/'))).toEqual([]);
    expect([...stored.keys()].filter((path) => path.includes('/sinopia-send-pending/'))).toHaveLength(1);
  });

  it('should prevent dismissal while remote delivery is in flight', async () => {
    setLanguage('en');
    const user = userEvent.setup();
    const remote = Promise.withResolvers<SinopiaSendReceipt>();
    vi.mocked(sinopiaSender.send).mockReturnValue(remote.promise);
    const view = mount();
    await user.click(await screen.findByRole('button', { name: 'Send version 3' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Preparing and sending');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(view.onOpenChange).not.toHaveBeenCalled();
    await act(async () => {
      remote.resolve({
        assetId: '40000000-0000-4000-8000-000000000001',
        projectId,
        modelId: link.modelId,
        userId: owner,
        versionNumber: 3,
        createdAt: Date.now(),
      });
    });
    await waitFor(() => {
      expect(view.onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
