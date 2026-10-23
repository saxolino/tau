import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { SinopiaReferenceImage, SinopiaReferenceSelection } from '#services/sinopia-references.js';
import { SinopiaProjectStrip } from '#routes/_index/sinopia-project-strip.js';

const state = vi.hoisted(() => ({ userId: 'user-a' }));
const projects = vi.hoisted(() => vi.fn());
const images = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
vi.mock('#hooks/use-sinopia-session.js', () => ({
  useSinopiaSession: () => ({ status: 'signed-in', user: { id: state.userId } }),
}));
vi.mock('#services/sinopia-references.js', () => ({
  listSinopiaReferenceProjects: projects,
  listSinopiaReferenceImages: images,
  downloadSinopiaReferenceImage: download,
}));
const picture = (id: string, kind: SinopiaReferenceImage['kind']): SinopiaReferenceImage => ({
  id,
  userId: 'user-a',
  projectId: 'project-a',
  kind,
  name: kind === 'library' ? 'Clasp' : undefined,
  location: { bucket: 'creator-private', path: `projects/project-a/${id}.png` },
  ...(kind === 'library' ? { widthMm: 10, heightMm: 4 } : {}),
});
const clients: QueryClient[] = [];
const choose = vi.fn<(selection: SinopiaReferenceSelection) => Promise<void>>(async () => undefined);
function mount(): ReturnType<typeof render> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <SinopiaProjectStrip onChoose={choose} isPickerOpen={false} onPickerOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.userId = 'user-a';
  setLanguage('it');
  projects.mockResolvedValue([
    { id: 'project-a', userId: 'user-a', name: 'Spring necklace', updatedAt: null, thumbnail: undefined },
  ]);
  images.mockResolvedValue([picture('render', 'render'), picture('sketch', 'drawing'), picture('clasp', 'library')]);
  download.mockResolvedValue(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) {
    client.clear();
  }
  resetLanguageForTests();
  localStorage.clear();
});

describe('SinopiaProjectStrip', () => {
  it.each(['it', 'en'] as const)(
    'should select images across filters and hand actual files with their origin to the shared intake in %s',
    async (language) => {
      setLanguage(language);
      mount();
      await userEvent.click(await screen.findByRole('button', { name: 'Spring necklace' }));
      const library = await screen.findByRole('button', { name: language === 'it' ? 'Libreria' : 'Library' });
      await userEvent.click(library);
      expect(await screen.findByRole('button', { name: 'Clasp' })).toHaveTextContent('10 × 4 mm');
      await userEvent.click(screen.getByRole('button', { name: 'Clasp' }));
      await userEvent.click(screen.getByRole('button', { name: language === 'it' ? 'Tutte' : 'All' }));
      await userEvent.click(screen.getByRole('button', { name: language === 'it' ? 'Seleziona tutte' : 'Select all' }));
      await userEvent.click(
        screen.getByRole('button', { name: language === 'it' ? 'Usa 3 immagini' : 'Use 3 images' }),
      );
      await waitFor(() => {
        expect(choose).toHaveBeenCalledOnce();
      });
      const selection = choose.mock.calls[0]![0];
      expect(selection.projectId).toBe('project-a');
      expect(selection.userId).toBe('user-a');
      expect(selection.files.map((file) => file.type)).toEqual(['image/png', 'image/png', 'image/png']);
      expect(selection.files.every((file) => file.name.startsWith('sinopia-') && file.size === 4)).toBe(true);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    },
  );

  it('should expose loading, retry and empty states without masking a failed list as empty', async () => {
    projects.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    mount();
    expect(screen.getByRole('status', { name: 'Carico i progetti di Sinopia…' })).toHaveAttribute('aria-busy', 'true');
    expect(await screen.findByRole('alert')).toHaveTextContent('Controlla la connessione e riprova');
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(await screen.findByRole('link', { name: 'Apri il Creator' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/creator',
    );
  });

  it('should report an image failure and allow retry', async () => {
    images.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Spring necklace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere le immagini');
    await userEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(
      await screen.findByText('Nessuna immagine in questa sezione. Scegli un altro filtro o aggiungila nel Creator.'),
    ).toBeInTheDocument();
  });

  it('should discard the image sheet and selection when the admitted account changes', async () => {
    const view = mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Spring necklace' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Seleziona tutte' }));
    state.userId = 'user-b';
    await act(async () => {
      view.rerender(
        <QueryClientProvider client={clients[0]!}>
          <SinopiaProjectStrip onChoose={choose} isPickerOpen={false} onPickerOpenChange={vi.fn()} />
        </QueryClientProvider>,
      );
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(choose).not.toHaveBeenCalled();
  });
});
