// @vitest-environment jsdom
import { render, renderHook, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { TurnSummaryCard, useTurnUndo } from '#components/chat/turn-summary-card.js';
import type { RevisionCard } from '#hooks/use-revisions.js';
import { setLanguage } from '#i18n/language.js';

const revisions = vi.hoisted(() => ({
  headRevisionId: 'r3' as string | undefined,
  isDirty: false,
  canUndo: true,
  busy: false,
  undoOperation: vi.fn(),
}));
vi.mock('#hooks/use-project.js', () => ({ useProject: vi.fn() }));
vi.mock('#hooks/use-revision-status.js', () => ({
  useRevisionClient: vi.fn(),
  useRevisionStatus: () => ({ restore: { canUndo: revisions.canUndo, busy: revisions.busy } }),
  useRevisionCommands: () => ({ undoOperation: revisions.undoOperation }),
}));
vi.mock('#hooks/use-revisions.js', () => ({
  useTurnRevision: vi.fn(),
  useRevisionChanges: vi.fn(),
  useRevisionCards: vi.fn(),
  useRevisions: () => ({ headRevisionId: revisions.headRevisionId, isDirty: revisions.isDirty }),
}));
beforeEach(() => {
  setLanguage('it');
  Object.assign(revisions, { headRevisionId: 'r3', isDirty: false, canUndo: true, busy: false });
  revisions.undoOperation.mockClear();
});
describe('turn summary', () => {
  it('should disclose the exact change and select the identified model piece', () => {
    const onSelect = vi.fn();
    render(
      <TurnSummaryCard
        revision={3}
        changes={[
          {
            id: 'wall',
            name: 'Castone marquise',
            pieceId: 'bezel',
            field: 'Parete',
            before: '0,3 mm',
            after: '0,4 mm',
            owned: true,
          },
        ]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText('Cosa ho cambiato · Rev 3'));
    expect(screen.getByText(/0,3 mm → 0,4 mm/u)).toBeInTheDocument();
    expect(screen.getByText('tuo valore')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Castone marquise' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ pieceId: 'bezel' }));
  });
  it('should disclose an honest fallback without making up a revision number', () => {
    setLanguage('en');
    render(<TurnSummaryCard changes={[]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText('What I changed'));
    expect(screen.getByText('Model changes')).toBeInTheDocument();
    expect(screen.queryByText(/Rev/u)).not.toBeInTheDocument();
  });
  it('should take the turn back with one «Annulla»', () => {
    const onAnnulla = vi.fn();
    render(
      <TooltipProvider>
        <TurnSummaryCard changes={[]} revision={3} annulla={{ stato: 'pronto', onAnnulla }} onSelect={vi.fn()} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onAnnulla).toHaveBeenCalledOnce();
  });
});

describe('useTurnUndo', () => {
  const turno: RevisionCard = {
    revisionId: 'r3',
    n: 3,
    createdAt: 0,
    summary: '',
    actor: 'agent',
    turnId: 'turn',
    conflicted: false,
    trigger: 'turn',
  };

  it('should undo through the history while the turn is still the head', () => {
    const { result } = renderHook(() => useTurnUndo(turno));
    expect(result.current).toEqual({ stato: 'pronto', onAnnulla: revisions.undoOperation });
  });

  it('should offer nothing once something came after, the checkout has unsaved changes, or the history refuses', () => {
    revisions.headRevisionId = 'r4';
    expect(renderHook(() => useTurnUndo(turno)).result.current).toBeUndefined();
    revisions.headRevisionId = 'r3';
    revisions.isDirty = true;
    expect(renderHook(() => useTurnUndo(turno)).result.current).toBeUndefined();
    revisions.isDirty = false;
    revisions.canUndo = false;
    expect(renderHook(() => useTurnUndo(turno)).result.current).toBeUndefined();
    expect(renderHook(() => useTurnUndo(undefined)).result.current).toBeUndefined();
  });

  it('should say the undo is running while the history restores', () => {
    revisions.busy = true;
    expect(renderHook(() => useTurnUndo(turno)).result.current).toEqual({ stato: 'in_corso' });
  });
});
