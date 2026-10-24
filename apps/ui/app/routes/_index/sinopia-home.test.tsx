import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useImperativeHandle } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import type { SinopiaReferenceSelection } from '#services/sinopia-references.js';
import type { ChatTextareaHandle } from '#components/chat/chat-textarea-types.js';
import type { ModelSupport } from '@taucad/chat';

type HomeTestState = {
  isMobile: boolean;
  isSinopiaSignedIn: boolean;
  draftText: string;
  attachingMain: boolean;
  editorCanSubmit: boolean;
  support: ModelSupport | undefined;
  attachments: Array<{ hash: string; mediaType: string; filename?: string }>;
};

const state = vi.hoisted(
  (): HomeTestState => ({
    isMobile: false,
    isSinopiaSignedIn: false,
    draftText: '',
    attachingMain: false,
    editorCanSubmit: false,
    support: { modalities: { input: ['text', 'image'], output: ['text'] } },
    attachments: [],
  }),
);
const viewport = vi.hoisted(() => ({ mode: 'desktop' }));
vi.mock('#hooks/use-cad-viewport.js', () => ({ useCadViewport: () => viewport.mode }));
vi.mock('#hooks/use-sinopia-session.js', () => ({
  useSinopiaSession: () =>
    state.isSinopiaSignedIn ? { status: 'signed-in', user: { id: 'user-a' } } : { status: 'disabled' },
}));
const sinopiaProjects = vi.hoisted(() => vi.fn());
const sinopiaImages = vi.hoisted(() => vi.fn());
const sinopiaDownload = vi.hoisted(() => vi.fn());
const rememberReferences = vi.hoisted(() =>
  vi.fn<(selection: SinopiaReferenceSelection) => Promise<SinopiaReferenceSelection>>(async (selection) => selection),
);
vi.mock('#services/sinopia-references.js', () => ({
  listSinopiaReferenceProjects: sinopiaProjects,
  listSinopiaReferenceImages: sinopiaImages,
  downloadSinopiaReferenceImage: sinopiaDownload,
}));

const submitEditor = vi.hoisted(() => vi.fn(async () => undefined));
const submitProject = vi.hoisted(() => vi.fn(async () => undefined));
const removeDraftAttachment = vi.hoisted(() => vi.fn());
const setDraftText = vi.hoisted(() => vi.fn());
vi.mock('#components/chat/use-new-project-submit.js', () => ({
  useNewProjectSubmit: () => ({
    onSubmit: submitProject,
    isSubmitting: false,
    rememberReferences,
  }),
}));

const addDraftAttachment = vi.hoisted(() =>
  vi.fn<(dataUrl: string, options: Readonly<{ model: unknown; filename?: string }>) => void>(),
);
const focusComposer = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@taucad/ui/hooks/use-mobile', () => ({
  useIsMobile: () => state.isMobile,
}));
vi.mock('#components/ui/sonner.js', () => ({ toast: { error: toastError } }));
vi.mock('#hooks/active-chat-provider.js', () => ({
  HomeNewProjectComposerProvider: ({ children }: { readonly children: React.ReactNode }) => (
    <div data-testid='home-composer-provider'>{children}</div>
  ),
  useChatComposer: () => ({
    model: {
      model: { name: 'Modello di prova', model: { support: state.support } },
    },
    execution: { execution: { kind: 'tau', model: 'modello-di-prova' } },
  }),
}));
vi.mock('#hooks/use-chat.js', () => ({
  useDraftActions: () => ({ addDraftAttachment, removeDraftAttachment, setDraftText }),
  useDraftSelector: <T,>(
    selector: (draft: { draftAttachments: typeof state.attachments; draftText: string; attachingMain: boolean }) => T,
  ): T =>
    selector({ draftAttachments: state.attachments, draftText: state.draftText, attachingMain: state.attachingMain }),
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
    useImperativeHandle(ref, () => ({
      focus: focusComposer,
      submit: state.editorCanSubmit ? submitEditor : undefined,
    }));
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
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KeyboardProvider>
        <TooltipProvider>
          <MemoryRouter>
            <SinopiaHome />
          </MemoryRouter>
        </TooltipProvider>
      </KeyboardProvider>
    </QueryClientProvider>,
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
  it('should open the agent in a right sheet on a tablet while keeping the image intake visible', () => {
    viewport.mode = 'tablet';
    renderHome();
    expect(screen.getByRole('dialog', { name: 'Agente' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Dall’immagine al CAD' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Agente' })).not.toBeInTheDocument();
  });

  it('should replace the home and composer with the supported-device message on a phone', () => {
    viewport.mode = 'phone';
    renderHome();
    expect(screen.getByRole('link', { name: 'Apri Sinopia' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.localStorage.clear();
    setLanguage('it');
    // Reset the shared preference cache as well as its storage.
    rememberAgentLaneOpen(true);
    state.isMobile = false;
    viewport.mode = 'desktop';
    state.isSinopiaSignedIn = false;
    sinopiaProjects.mockResolvedValue([]);
    sinopiaImages.mockResolvedValue([]);
    state.support = {
      modalities: { input: ['text', 'image'], output: ['text'] },
    };
    state.attachments = [];
    state.draftText = '';
    state.attachingMain = false;
    state.editorCanSubmit = false;
  });

  afterEach(() => {
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });

  it.each([
    {
      language: 'it',
      title: 'Dall’immagine al CAD',
      choose: 'Scegli un’immagine',
      hint: /incollala con .+ · JPG, PNG, WebP o GIF, fino a 20 MB/u,
      dragHere: 'Trascina qui la foto o il disegno',
      lane: 'Agente',
    },
    {
      language: 'en',
      title: 'From image to CAD',
      choose: 'Choose an image',
      hint: /paste it with .+ · JPG, PNG, WebP or GIF, up to 20 MB/u,
      dragHere: 'Drag the photo or drawing here',
      lane: 'Agent',
    },
  ] as const)('writes the hero and the drop zone in $language', ({ language, title, choose, hint, dragHere, lane }) => {
    setLanguage(language);
    renderHome();

    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: choose })).toHaveAccessibleDescription(hint);
    expect(screen.getByText(dragHere)).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: lane })).toBeInTheDocument();
  });

  it('refuses a file that is not a picture in English, naming it with straight quotes', async () => {
    setLanguage('en');
    renderHome();

    fireEvent.change(pickerInput(), {
      target: { files: [picture('drawing.pdf', 'application/pdf')] },
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('"drawing.pdf" is not in a format the agent can read', {
        description: 'Use JPG, PNG, WebP or GIF, up to 20 MB.',
      });
    });
  });

  it('shows the Italian hero, the drop zone, the projects and the agent lane with the home composer', () => {
    renderHome();

    expect(screen.getByRole('heading', { level: 1, name: 'Dall’immagine al CAD' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scegli un’immagine' })).toHaveAccessibleDescription(
      /incollala con .+ · JPG, PNG, WebP o GIF, fino a 20 MB/u,
    );
    expect(pickerInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp,image/gif');
    expect(screen.getByRole('heading', { level: 2, name: 'I tuoi progetti' })).toBeInTheDocument();
    // The lane: the same hide button as the project page's agent lane, and the one composer, inside the home draft's provider.
    const lane = agentLane();
    expect(within(lane).getByRole('button', { name: 'Nascondi l’agente' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+C',
    );
    expect(
      within(lane).getByRole('textbox', {
        name: 'Descrivi cosa costruire o cosa cambiare…',
      }),
    ).toBeInTheDocument();
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

    fireEvent.change(pickerInput(), {
      target: { files: [picture('anello.png')] },
    });

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

    fireEvent.dragEnter(heading, {
      dataTransfer: { types: ['Files'], files: [] },
    });
    expect(screen.getByText('Lascia qui l’immagine')).toBeInTheDocument();
    fireEvent.drop(heading, {
      dataTransfer: {
        types: ['Files'],
        files: [picture('spilla.webp', 'image/webp')],
      },
    });

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
    fireEvent.drop(composer, {
      dataTransfer: { types: ['Files'], files: [picture()] },
    });
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
      expect(toastError).toHaveBeenCalledWith('L’agente non può leggere immagini in questo momento', expect.anything());
    });
    expect(addDraftAttachment).not.toHaveBeenCalled();
  });

  it('shows one thumbnail per image without exposing filenames', () => {
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
    ).toEqual(['Immagine allegata', 'Immagine allegata']);
  });

  it('hides and shows the lane with its toggle and ⌃C, remembering the choice', async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(within(agentLane()).getByRole('button', { name: 'Nascondi l’agente' }));

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
  it.each(['it', 'en'] as const)('should open the shared real Sinopia project picker in %s', async (language) => {
    setLanguage(language);
    state.isSinopiaSignedIn = true;
    renderHome();
    await userEvent.click(
      screen.getByRole('button', { name: language === 'it' ? 'Da un progetto Sinopia' : 'From a Sinopia project' }),
    );
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveAccessibleName(language === 'it' ? 'Da Sinopia' : 'From Sinopia');
    expect(sheet).toHaveTextContent(
      language === 'it'
        ? 'Scegli un progetto qui sotto per vedere le sue immagini.'
        : 'Choose a project below to see its images.',
    );
    expect(within(sheet).queryByRole('list')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should pass chosen Sinopia images through the existing draft attachment intake and remember their project', async () => {
    state.isSinopiaSignedIn = true;
    sinopiaProjects.mockResolvedValue([
      { id: 'project-a', userId: 'user-a', name: 'Spring necklace', updatedAt: null, thumbnail: undefined },
    ]);
    sinopiaImages.mockResolvedValue([
      {
        id: 'image-a',
        userId: 'user-a',
        projectId: 'project-a',
        kind: 'render',
        name: undefined,
        location: { bucket: 'creator-private', path: 'projects/project-a/image.png' },
      },
    ]);
    sinopiaDownload.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    renderHome();
    await userEvent.click(await screen.findByRole('button', { name: 'Spring necklace' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Seleziona tutte' }));
    await userEvent.click(screen.getByRole('button', { name: 'Usa 1 immagini' }));
    await waitFor(() => {
      expect(addDraftAttachment).toHaveBeenCalledOnce();
    });
    expect(addDraftAttachment.mock.calls[0]![0]).toMatch(/^data:image\/png;base64,/);
    expect(addDraftAttachment.mock.calls[0]![1].filename).toMatch(/^sinopia-/);
    const selection = rememberReferences.mock.calls[0]![0];
    expect(selection.userId).toBe('user-a');
    expect(selection.projectId).toBe('project-a');
    expect(selection.files).toHaveLength(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should build with the draft words and known size even when the agent lane is closed', async () => {
    rememberAgentLaneOpen(false);
    state.attachments = [{ hash: 'a'.repeat(64), mediaType: 'image/png' }];
    state.draftText = 'Una collana in oro';
    renderHome();
    const measure = screen.getByRole('textbox', { name: 'Una misura che conosci (facoltativa)' });
    fireEvent.change(measure, { target: { value: 'marquise 10 × 4 mm' } });
    expect(measure).toHaveValue('marquise 10 × 4 mm');
    await userEvent.click(screen.getByRole('button', { name: 'Costruisci il CAD' }));
    expect(submitProject).toHaveBeenCalledOnce();
    expect(submitProject).toHaveBeenCalledWith({
      content: 'Una collana in oro\n\nUna misura che conosco: marquise 10 × 4 mm',
      attachments: [],
    });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('should use an image request in English and wait for attachments to settle', async () => {
    setLanguage('en');
    state.attachments = [{ hash: 'a'.repeat(64), mediaType: 'image/png' }];
    state.attachingMain = true;
    const view = renderHome();
    expect(screen.getByRole('button', { name: 'Build the CAD' })).toBeDisabled();
    state.attachingMain = false;
    view.rerender(
      <KeyboardProvider>
        <TooltipProvider>
          <MemoryRouter>
            <SinopiaHome />
          </MemoryRouter>
        </TooltipProvider>
      </KeyboardProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Build the CAD' }));
    expect(submitProject).toHaveBeenCalledWith({
      content: 'Build the CAD from the attached images, in named pieces.',
      attachments: [],
    });
  });

  it('should ask a mounted composer to finish dictation and send before using a direct image request', async () => {
    state.editorCanSubmit = true;
    state.attachments = [{ hash: 'a'.repeat(64), mediaType: 'image/png' }];
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: 'Costruisci il CAD' }));
    expect(submitEditor).toHaveBeenCalledOnce();
    expect(submitProject).not.toHaveBeenCalled();
  });

  it('should remove images by their draft indices and cancel images without deleting typed words or documents', async () => {
    state.attachments = [
      { hash: 'd'.repeat(64), mediaType: 'application/pdf' },
      { hash: 'a'.repeat(64), mediaType: 'image/png' },
      { hash: 'b'.repeat(64), mediaType: 'image/jpeg' },
      { hash: 'a'.repeat(64), mediaType: 'image/png' },
    ];
    renderHome();
    await userEvent.click(screen.getAllByRole('button', { name: 'Togli Immagine allegata' })[0]!);
    expect(removeDraftAttachment.mock.calls).toEqual([[3], [1]]);
    removeDraftAttachment.mockClear();
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(removeDraftAttachment.mock.calls).toEqual([[3], [2], [1]]);
    expect(setDraftText).not.toHaveBeenCalled();
    expect(submitProject).not.toHaveBeenCalled();
  });

  it.each(['Un anello con solitario da 6 mm', 'Una fibbia 30 mm per cinturino', 'Un ciondolo goccia con castone'])(
    'should put the suggestion %s into the draft without sending it',
    async (name) => {
      renderHome();
      expect(screen.getByRole('heading', { name: 'Dimmi cosa vuoi fare' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name }));
      expect(setDraftText).toHaveBeenLastCalledWith(name);
      expect(focusComposer).toHaveBeenCalledOnce();
      expect(submitProject).not.toHaveBeenCalled();
    },
  );
});
