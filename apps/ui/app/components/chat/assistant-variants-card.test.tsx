import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { AssistantVariantsCard } from '#components/chat/assistant-variants-card.js';
import type { ContenutoVarianti, VarianteCard } from '#components/chat/assistant-variants-card.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

const varianti: VarianteCard[] = [
  {
    id: 'locale-slanciata',
    nome: 'Più slanciata',
    anteprima: 'blob:slanciata',
    righe: [
      { id: 'telaio.sezioneLarghezza', etichetta: 'Larghezza sezione', prima: '3 mm', dopo: '2,4 mm' },
      { id: 'telaio.sezioneSpessore', etichetta: 'Spessore sezione', prima: '2,5 mm', dopo: '2,1 mm' },
    ],
    peso: { prima: '4,5 g', dopo: '3,7 g', variazione: '−18 %' },
  },
  {
    id: 'locale-robusta',
    nome: 'Più robusta',
    anteprima: 'blob:robusta',
    righe: [{ id: 'telaio.sezioneLarghezza', etichetta: 'Larghezza sezione', prima: '3 mm', dopo: '3,9 mm' }],
    peso: { prima: '4,5 g', dopo: '6,1 g', variazione: '+36 %' },
    avviso: 'Esce dalle verifiche di producibilità: controllala prima di usarla.',
  },
  {
    id: 'locale-minimale',
    nome: 'Più minimale',
    righe: [{ id: 'telaio.profilo', etichetta: 'Profilo', prima: 'bombato', dopo: 'piatto' }],
  },
];

const renderCard = (props: Partial<React.ComponentProps<typeof AssistantVariantsCard>> = {}) => {
  const azioni = { onUsa: vi.fn(), onScarta: vi.fn(), onChiudi: vi.fn() };
  const risultato = render(
    <TooltipProvider>
      <AssistantVariantsCard
        titolo='Varianti · Fibbia · rettangolare'
        contenuto={{ stato: 'pronto', varianti }}
        {...azioni}
        {...props}
      />
    </TooltipProvider>,
  );
  return { ...risultato, ...azioni };
};

beforeEach(() => {
  setLanguage('it');
});
afterEach(() => {
  resetLanguageForTests();
});

describe('AssistantVariantsCard', () => {
  it('should show the variants side by side with their previews, and the chosen one’s differences in numbers', () => {
    renderCard();
    const scelte = within(screen.getByRole('radiogroup', { name: 'Varianti proposte' })).getAllByRole('radio');
    expect(scelte).toHaveLength(3);
    expect(scelte[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('img', { name: 'Anteprima di «Più slanciata»' })).toHaveAttribute('src', 'blob:slanciata');
    // A variant without a preview says so instead of an empty box.
    expect(screen.getByText('Anteprima non disponibile')).toBeInTheDocument();
    expect(screen.getByText('3 mm → 2,4 mm')).toBeInTheDocument();
    expect(screen.getByText('4,5 g → 3,7 g')).toBeInTheDocument();
    expect(screen.getByText('1 di 3')).toBeInTheDocument();
    // One filled button: «Usa questa».
    expect(screen.getAllByRole('button').filter((button) => button.className.includes('primary-action'))).toHaveLength(
      1,
    );
  });

  it('should walk the variants with the arrows, use the chosen one with Enter and close with Esc', async () => {
    const user = userEvent.setup();
    const { onUsa, onChiudi } = renderCard({ autoFocus: true });
    const scelte = screen.getAllByRole('radio');
    expect(scelte[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(scelte[1]).toHaveFocus();
    expect(scelte[1]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Esce dalle verifiche di producibilità: controllala prima di usarla.')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(scelte[2]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onUsa).toHaveBeenCalledExactlyOnceWith('locale-minimale');
    await user.keyboard('{Escape}');
    expect(onChiudi).toHaveBeenCalledOnce();
  });

  it('should use or discard the chosen variant with its buttons', async () => {
    const user = userEvent.setup();
    const { onUsa, onScarta } = renderCard();
    await user.click(screen.getAllByRole('radio')[1]!);
    await user.click(screen.getByRole('button', { name: 'Scarta' }));
    expect(onScarta).toHaveBeenCalledExactlyOnceWith('locale-robusta');
    await user.click(screen.getByRole('button', { name: 'Usa questa' }));
    expect(onUsa).toHaveBeenCalledExactlyOnceWith('locale-robusta');
  });

  it('should keep every action waiting while a variant is applied', () => {
    renderCard({ inApplicazione: 'locale-slanciata' });
    expect(screen.getByRole('button', { name: 'Applico…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Scarta' })).toBeDisabled();
  });

  it.each<[string, ContenutoVarianti, string]>([
    ['loading', { stato: 'caricamento' }, 'Preparo le varianti…'],
    ['empty', { stato: 'vuoto', messaggio: 'Nessuna variante da proporre.' }, 'Nessuna variante da proporre.'],
  ])('should say what is happening when %s', (_caso, contenuto, testo) => {
    renderCard({ contenuto });
    expect(screen.getByText(testo)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('should offer to try again after a failure, and mark the agent’s variants', async () => {
    const user = userEvent.setup();
    const onRiprova = vi.fn();
    renderCard({ daAgente: true, contenuto: { stato: 'errore', messaggio: 'Non riesco.', onRiprova } });
    expect(screen.getByRole('alert')).toHaveTextContent('Non riesco.');
    expect(screen.getByText('Dall’assistente')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Riprova' }));
    expect(onRiprova).toHaveBeenCalledOnce();
  });
});
