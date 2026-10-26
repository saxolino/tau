import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeometryComponentNode } from '@taucad/types';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { InspectorSelection } from '#lib/inspector-selection.js';

const capabilities = {
  canHide: true,
  canIsolate: true,
  canFocus: true,
  canAdjustOpacity: true,
  hasDrawings: false,
  hasPreciseTopology: true,
  exports: [],
};
const frame: GeometryComponentNode = {
  id: 'frame',
  name: 'Telaio fibbia',
  kind: 'part',
  selector: 'frame',
  childIds: [],
  depth: 0,
  path: [],
  meshNodeIndices: [],
  primitiveIndices: [],
  materialIndices: [],
  capabilities,
  extras: { manualBounds: { min: [-18, -12.5, -2], max: [18, 12.5, 2] } },
};

type SuggestionState = { selection: InspectorSelection; canReadImages: boolean; session: string };
const state = vi.hoisted(
  (): SuggestionState => ({ selection: { kind: 'model', pieceCount: 2 }, canReadImages: true, session: 'signed-out' }),
);
const setDraftText = vi.hoisted(() => vi.fn());
const addImages = vi.hoisted(() => vi.fn(async (files: Iterable<File>) => [...files].length));

vi.mock('#hooks/use-inspector-selection.js', () => ({
  useInspectorSelection: () => ({ selection: state.selection, piece: undefined }),
}));
vi.mock('#hooks/use-chat.js', () => ({ useDraftActions: () => ({ setDraftText }) }));
vi.mock('#hooks/use-sinopia-session.js', () => ({ useSinopiaSession: () => ({ status: state.session }) }));
vi.mock('#routes/_index/use-home-image-intake.js', () => ({
  homeImageAccept: 'image/png',
  useHomeImageIntake: () => ({ addImages, canReadImages: state.canReadImages }),
}));
vi.mock('#routes/_index/sinopia-project-strip.js', () => ({
  SinopiaProjectStrip: ({ isPickerOpen }: { readonly isPickerOpen: boolean }) =>
    isPickerOpen ? <div role='dialog' aria-label='Progetti Sinopia' /> : null,
}));

const { AssistantComposerProvider, AssistantContextChips, AssistantStarts } =
  await import('#components/chat/assistant-suggestions.js');

const focusComposer = vi.fn();
const renderWith = (children: React.ReactNode) =>
  render(
    <TooltipProvider>
      <AssistantComposerProvider focusComposer={focusComposer}>{children}</AssistantComposerProvider>
    </TooltipProvider>,
  );

beforeEach(() => {
  setLanguage('it');
  state.selection = { kind: 'model', pieceCount: 2 };
  state.canReadImages = true;
  state.session = 'signed-out';
  vi.clearAllMocks();
});
afterEach(() => {
  resetLanguageForTests();
});

describe('AssistantContextChips', () => {
  it('should offer the selection’s edits and fill the composer with one, without sending it', async () => {
    const user = userEvent.setup();
    state.selection = { kind: 'piece', node: frame };
    renderWith(<AssistantContextChips />);
    const chips = screen.getAllByRole('button');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Arrotonda gli spigoli di Telaio fibbia a r 0,6 mm',
      'Assottiglia Telaio fibbia di 1 mm',
      'Porta la lunghezza di Telaio fibbia a 39,5 mm',
    ]);
    await user.click(chips[1]!);
    expect(setDraftText).toHaveBeenCalledExactlyOnceWith('Assottiglia Telaio fibbia di 1 mm');
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it('should change with the selection: a face, its edges, the whole model', () => {
    state.selection = { kind: 'face', node: frame, direction: 'top' };
    const { rerender } = renderWith(<AssistantContextChips />);
    expect(screen.getByRole('group', { name: 'Suggerimenti per la selezione' })).toHaveTextContent(
      'Alza la faccia superiore di Telaio fibbia di 1 mm',
    );
    state.selection = { kind: 'edge', node: frame, edgeCount: 2 };
    rerender(
      <TooltipProvider>
        <AssistantComposerProvider focusComposer={focusComposer}>
          <AssistantContextChips />
        </AssistantComposerProvider>
      </TooltipProvider>,
    );
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Raccorda gli spigoli selezionati di Telaio fibbia');
    state.selection = { kind: 'model', pieceCount: 2 };
    rerender(
      <TooltipProvider>
        <AssistantComposerProvider focusComposer={focusComposer}>
          <AssistantContextChips />
        </AssistantComposerProvider>
      </TooltipProvider>,
    );
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Controlla gli spessori minimi per la fusione');
  });
});

describe('AssistantStarts', () => {
  it('should start from a description by opening the composer with its first words', async () => {
    const user = userEvent.setup();
    renderWith(<AssistantStarts />);
    await user.click(screen.getByRole('button', { name: /Da una descrizione/u }));
    expect(setDraftText).toHaveBeenCalledExactlyOnceWith('Vorrei ');
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it('should put a chosen image in the draft through the home’s intake', async () => {
    const user = userEvent.setup();
    const { container } = renderWith(<AssistantStarts />);
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    await user.upload(input, new File(['png'], 'fibbia.png', { type: 'image/png' }));
    expect(addImages).toHaveBeenCalledOnce();
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it('should say why an image or a Sinopia project cannot be the start', async () => {
    const user = userEvent.setup();
    state.canReadImages = false;
    renderWith(<AssistantStarts />);
    const image = screen.getByRole('button', { name: /Da un’immagine/u });
    expect(image).toHaveAttribute('aria-disabled', 'true');
    expect(image).toHaveTextContent('Questo assistente non legge immagini');
    const sinopia = screen.getByRole('button', { name: /Da un progetto Sinopia/u });
    expect(sinopia).toHaveTextContent('Accedi con l’account Sinopia');
    await user.click(sinopia);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should fold the starts into one row under the inspector, with the same reasons', async () => {
    const user = userEvent.setup();
    state.canReadImages = false;
    renderWith(<AssistantStarts variant='row' />);
    const starts = screen.getAllByRole('button');
    expect(starts.map((start) => start.textContent)).toEqual([
      'Da un’immagine',
      'Da una descrizione',
      'Da un progetto Sinopia',
    ]);
    expect(starts[0]).toHaveAttribute('aria-disabled', 'true');
    await user.click(starts[1]!);
    expect(setDraftText).toHaveBeenCalledExactlyOnceWith('Vorrei ');
  });

  it('should open the Sinopia projects picker when signed in', async () => {
    const user = userEvent.setup();
    state.session = 'signed-in';
    renderWith(<AssistantStarts />);
    await user.click(screen.getByRole('button', { name: /Da un progetto Sinopia/u }));
    // The real sheets portal out of the hidden strip; this stand-in stays where it is rendered.
    expect(screen.getByRole('dialog', { name: 'Progetti Sinopia', hidden: true })).toBeInTheDocument();
  });
});
