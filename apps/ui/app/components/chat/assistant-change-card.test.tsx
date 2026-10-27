import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { AssistantChangeCard } from '#components/chat/assistant-change-card.js';
import type { RigaCambiamento } from '#components/chat/assistant-change-card.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

const righe: RigaCambiamento[] = [
  { id: 'a', pezzo: 'Telaio', etichetta: 'Larghezza sezione', prima: '3 mm', dopo: '2,4 mm', selezionabile: true },
  { id: 'b', pezzo: 'Telaio', etichetta: 'Spessore sezione', prima: '2,5 mm', dopo: '2,1 mm' },
  { id: 'c', etichetta: 'Apertura', prima: '12 mm', dopo: '13,2 mm' },
  { id: 'd', etichetta: 'Raggio angoli', prima: '3 mm', dopo: '4,2 mm', tuo: true },
];

const renderCard = (props: Partial<React.ComponentProps<typeof AssistantChangeCard>> = {}) =>
  render(
    <TooltipProvider>
      <AssistantChangeCard titolo='Cosa ho cambiato' sottotitolo='Variante «Più slanciata»' righe={righe} {...props} />
    </TooltipProvider>,
  );

beforeEach(() => {
  setLanguage('it');
});
afterEach(() => {
  resetLanguageForTests();
});

describe('AssistantChangeCard', () => {
  it('should say what changed, before → after, three rows and then how many more', async () => {
    const user = userEvent.setup();
    renderCard();
    expect(screen.getByRole('region', { name: 'Cosa ho cambiato · Variante «Più slanciata»' })).toBeInTheDocument();
    expect(screen.getByText('3 mm → 2,4 mm')).toBeInTheDocument();
    expect(screen.queryByText('3 mm → 4,2 mm')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '+ 1 altra' }));
    expect(screen.getByText('3 mm → 4,2 mm')).toBeInTheDocument();
    expect(screen.getByText('tuo valore')).toBeInTheDocument();
  });

  it('should select a row’s piece when it can be selected', async () => {
    const user = userEvent.setup();
    const onSelezionaPezzo = vi.fn();
    renderCard({ onSelezionaPezzo });
    await user.click(screen.getByRole('button', { name: 'Telaio' }));
    expect(onSelezionaPezzo).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'a' }));
  });

  it('should undo the whole change with one button, busy while it runs, or say why it cannot', async () => {
    const user = userEvent.setup();
    const onAnnulla = vi.fn();
    const { rerender } = renderCard({ annulla: { stato: 'pronto', onAnnulla } });
    await user.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onAnnulla).toHaveBeenCalledOnce();
    rerender(
      <TooltipProvider>
        <AssistantChangeCard titolo='Cosa ho cambiato' righe={righe} annulla={{ stato: 'in_corso' }} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Annullo…' })).toBeDisabled();
    rerender(
      <TooltipProvider>
        <AssistantChangeCard
          titolo='Cosa ho cambiato'
          righe={righe}
          annulla={{ stato: 'non_disponibile', motivo: 'Le misure sono cambiate dopo.' }}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByRole('button', { name: /Annull/u })).not.toBeInTheDocument();
    expect(screen.getByText('Le misure sono cambiate dopo.')).toBeInTheDocument();
  });

  it('should close, and say an honest fallback when nothing can be listed', async () => {
    const user = userEvent.setup();
    const onChiudi = vi.fn();
    renderCard({ righe: [], vuoto: 'Modifiche al modello', onChiudi });
    expect(screen.getByText('Modifiche al modello')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(onChiudi).toHaveBeenCalledOnce();
  });
});
