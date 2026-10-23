import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useImperativeHandle } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type { ChatTextareaHandle } from '#components/chat/chat-textarea-types.js';
import type { ModelSupport } from '@taucad/chat';

type HomeTestState = {
  isMobile: boolean;
  support: ModelSupport | undefined;
  attachments: Array<{ hash: string; mediaType: string; filename?: string }>;
};

const state = vi.hoisted(
  (): HomeTestState => ({
    isMobile: false,
    support: { modalities: { input: ['text', 'image'], output: ['text'] } },
    attachments: [],
  }),
);
const addDraftAttachment = vi.hoisted(() => vi.fn());
const focusComposer = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@taucad/ui/hooks/use-mobile', () => ({ useIsMobile: () => state.isMobile }));
vi.mock('#components/ui/sonner.js', () => ({ toast: { error: toastError } }));
vi.mock('#hooks/active-chat-provider.js', () => ({
  HomeNewProjectComposerProvider: ({ children }: { readonly children: React.ReactNode }) => (
    <div data-testid='home-composer-provider'>{children}</div>
  ),
  useChatComposer: () => ({
    model: { model: { name: 'Modello di prova', model: { support: state.support } } },
    execution: { execution: { kind: 'tau', model: 'modello-di-prova' } },
  }),
}));
vi.mock('#hooks/use-chat.js', () => ({
  useDraftActions: () => ({ addDraftAttachment }),
  useDraftSelector: <T,>(selector: (draft: { draftAttachments: typeof state.attachments }) => T): T =>
    selector({ draftAttachments: state.attachments }),
}));
vi.mock('#components/chat/attachment-preview.js', () => ({
  homeComposerAttachmentDirectory: '/records/new-project/attachments',
  AttachmentImage: ({ alt }: { readonly alt: string }) => <img alt={alt} />,
}));
vi.mock('#components/chat/new-project-chat-composer.js', () => ({
  NewProjectChatComposer: ({
    ref,
    enableLocationPicker = true,
  }: {
    readonly ref?: React.Ref<ChatTextareaHandle>;
    readonly enableLocationPicker?: boolean;
  }) => {
    useImperativeHandle(ref, () => ({ focus: focusComposer }));
    return (
      <div role='textbox' aria-label='Descrivi cosa costruire o cosa cambiare…'>
        {enableLocationPicker ? 'Location picker' : undefined}
      </div>
    );
  },
}));
vi.mock('#routes/_index/home-recent-projects.js', () => ({
  HomeRecentProjects: () => (
    <section aria-label='I tuoi progetti'>
      <h2>I tuoi progetti</h2>
    </section>
  ),
}));

const { SinopiaHome } = await import('#routes/_index/sinopia-home.js');
const { rememberAgentLaneOpen } = await import('#hooks/use-agent-lane-open.js');

const renderHome = (): ReturnType<typeof render> =>
  render(
    <KeyboardProvider>
      <TooltipProvider>
        <MemoryRouter>
          <SinopiaHome />
        </MemoryRouter>
      </TooltipProvider>
    </KeyboardProvider>,
  );

const picture = (name = 'anello.png', type = 'image/png', size = 1024): File => {
  const file = new File([new Uint8Array(8)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const pickerInput = (): HTMLInputElement => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) {
    throw new Error('Expected the image picker input');
  }
  return input;
};

const agentLane = (): HTMLElement => screen.getByRole('complementary', { name: 'Agente' });

describe('SinopiaHome', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.clear();
    // Reset the shared preference cache as well as its storage.
    rememberAgentLaneOpen(true);
    state.isMobile = false;
    state.support = { modalities: { input: ['text', 'image'], output: ['text'] } };
    state.attachments = [];
  });

  it('shows the Italian hero, the drop zone, the projects and the agent lane with the home composer', () => {
    renderHome();

    expect(screen.getByRole('heading', { level: 1, name: 'Dall’immagine al CAD' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scegli un’immagine' })).toHaveAccessibleDescription(
      /incollala con .+ · JPG, PNG, WebP o GIF, fino a 20 MB/u,
    );
    expect(pickerInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif');
    expect(screen.getByRole('heading', { level: 2, name: 'I tuoi progetti' })).toBeInTheDocument();
    // The lane: the same toggle as the project page, pressed, and the one composer, inside the home draft's provider.
    const lane = agentLane();
    expect(within(lane).getByRole('button', { name: 'Agente' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(lane).getByRole('textbox', { name: 'Descrivi cosa costruire o cosa cambiare…' })).toBeInTheDocument();
    expect(screen.getByTestId('home-composer-provider')).toContainElement(lane);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('leaves out what was Tau’s: the location chip, Build from code, the English hero and the gallery', () => {
    renderHome();

    expect(screen.queryByText('Location picker')).not.toBeInTheDocument();
    expect(screen.queryByText(/Build from code/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/What can I help you build/iu)).not.toBeInTheDocument();
    expect(screen.queryByText(/Built with Tau/iu)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /community|view all/iu })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /kernel|engine|motore/iu })).not.toBeInTheDocument();
  });

  it('puts a chosen picture into the agent composer’s draft and focuses the composer', async () => {
    renderHome();

    fireEvent.change(pickerInput(), { target: { files: [picture('anello.png')] } });

    await waitFor(() => {
      expect(addDraftAttachment).toHaveBeenCalledOnce();
    });
    expect(addDraftAttachment).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/u), {
      model: { name: 'Modello di prova', support: state.support },
      filename: 'anello.png',
    });
    await waitFor(() => {
      expect(focusComposer).toHaveBeenCalled();
    });
    expect(screen.getByRole('status')).toHaveTextContent('Immagine allegata al messaggio per l’agente.');
  });

  it('takes a picture dropped anywhere on the home, and ignores a drop the composer already took', async () => {
    renderHome();
    const heading = screen.getByRole('heading', { level: 1 });

    fireEvent.dragEnter(heading, { dataTransfer: { types: ['Files'], files: [] } });
    expect(screen.getByText('Lascia qui l’immagine')).toBeInTheDocument();
    fireEvent.drop(heading, { dataTransfer: { types: ['Files'], files: [picture('spilla.webp', 'image/webp')] } });

    await waitFor(() => {
      expect(addDraftAttachment).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/webp;base64,/u), {
        model: expect.anything() as unknown,
        filename: 'spilla.webp',
      });
    });
    expect(screen.getByText('Trascina qui la foto o il disegno')).toBeInTheDocument();

    addDraftAttachment.mockClear();
    const composer = screen.getByRole('textbox');
    composer.addEventListener('drop', (event) => {
      event.preventDefault();
    });
    fireEvent.drop(composer, { dataTransfer: { types: ['Files'], files: [picture()] } });
    await Promise.resolve();
    expect(addDraftAttachment).not.toHaveBeenCalled();
  });

  it('takes a pasted picture unless the paste goes to a field', async () => {
    renderHome();
    const pasteInto = (target: EventTarget): void => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: { items: [], files: [picture('incollata.png')] },
      });
      target.dispatchEvent(event);
    };

    const field = document.createElement('input');
    document.body.append(field);
    pasteInto(field);
    await Promise.resolve();
    expect(addDraftAttachment).not.toHaveBeenCalled();
    field.remove();

    pasteInto(document.body);
    await waitFor(() => {
      expect(addDraftAttachment).toHaveBeenCalledOnce();
    });
  });

  it('refuses files that are not pictures it reads, and pictures over 20 MB, saying why', async () => {
    renderHome();

    fireEvent.change(pickerInput(), {
      target: {
        files: [
          picture('disegno.pdf', 'application/pdf'),
          picture('foto.heic', 'image/heic'),
          picture('scansione.png', 'image/png', 21 * 1024 * 1024),
          picture('ciondolo.jpg', 'image/jpeg'),
        ],
      },
    });

    await waitFor(() => {
      expect(addDraftAttachment).toHaveBeenCalledOnce();
    });
    expect(addDraftAttachment).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/jpeg;base64,/u), {
      model: expect.anything() as unknown,
      filename: 'ciondolo.jpg',
    });
    expect(toastError).toHaveBeenCalledWith('«disegno.pdf» non è in un formato che l’agente sa leggere', {
      description: 'Usa JPG, PNG, WebP o GIF, fino a 20 MB.',
    });
    expect(toastError).toHaveBeenCalledWith(
      '«foto.heic» non è in un formato che l’agente sa leggere',
      expect.anything(),
    );
    expect(toastError).toHaveBeenCalledWith('«scansione.png» supera i 20 MB', expect.anything());
  });

  it('refuses pictures when the agent’s model reads no images', async () => {
    state.support = { modalities: { input: ['text'], output: ['text'] } };
    renderHome();

    fireEvent.change(pickerInput(), { target: { files: [picture()] } });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        'L’agente non può leggere immagini con il modello scelto',
        expect.anything(),
      );
    });
    expect(addDraftAttachment).not.toHaveBeenCalled();
  });

  it('shows the pictures already in the draft, named by their file', () => {
    state.attachments = [
      { hash: 'a'.repeat(64), mediaType: 'image/png', filename: 'anello.png' },
      { hash: 'a'.repeat(64), mediaType: 'image/png', filename: 'anello.png' },
      { hash: 'b'.repeat(64), mediaType: 'image/jpeg' },
    ];
    renderHome();

    const list = screen.getByRole('list', { name: 'Immagini per l’agente' });
    expect(
      within(list)
        .getAllByRole('img')
        .map((image) => image.getAttribute('alt')),
    ).toEqual(['anello.png', 'Immagine allegata']);
  });

  it('hides and shows the lane with its toggle and ⌃C, remembering the choice', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(within(agentLane()).getByRole('button', { name: 'Agente' }));

    expect(screen.queryByRole('complementary', { name: 'Agente' })).not.toBeInTheDocument();
    const closedToggle = screen.getByRole('button', { name: 'Agente' });
    expect(closedToggle).toHaveAttribute('aria-pressed', 'false');
    expect(closedToggle).toHaveAttribute('aria-keyshortcuts', 'Control+C');
    expect(globalThis.localStorage.getItem('tau-chat-op-lane')).toBe('false');

    await user.keyboard('{Control>}c{/Control}');

    expect(agentLane()).toBeInTheDocument();
    expect(globalThis.localStorage.getItem('tau-chat-op-lane')).toBe('true');
  });

  it('follows the lane state a project page last chose', () => {
    rememberAgentLaneOpen(false);
    const view = renderHome();
    expect(screen.queryByRole('complementary', { name: 'Agente' })).not.toBeInTheDocument();
    view.unmount();

    act(() => {
      rememberAgentLaneOpen(true);
    });
    renderHome();
    expect(agentLane()).toBeInTheDocument();
  });

  it('opens a hidden lane when a picture arrives', async () => {
    rememberAgentLaneOpen(false);
    renderHome();

    fireEvent.change(pickerInput(), { target: { files: [picture()] } });

    expect(await screen.findByRole('complementary', { name: 'Agente' })).toBeInTheDocument();
  });

  it('puts the composer under the drop zone on a phone, without a lane', () => {
    state.isMobile = true;
    renderHome();

    expect(screen.queryByRole('complementary', { name: 'Agente' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agente' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Messaggio per l’agente' })).toContainElement(
      screen.getByRole('textbox'),
    );
  });
});
