import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantBriefCard } from '#components/chat/assistant-brief-card.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { ChipAssistente, SchedaModello } from '#lib/assistant-brief.js';

const scheda: SchedaModello = {
  titolo: 'Fibbia · rettangolare',
  daFoto: true,
  misure: [
    { etichetta: 'Luce', valore: '21 mm' },
    { etichetta: 'Apertura', valore: '12 mm' },
    { etichetta: 'Sezione', valore: '3 × 2,5 mm' },
  ],
  dettagli: ['Zama ≈ 4,5 g', '27 × 18 × 5,6 mm'],
  stato: ['sagoma 0,94', '2 ipotesi da controllare'],
};
const chips: ChipAssistente[] = [
  {
    id: 'correzione-PARETE_MIN',
    tipo: 'modifica',
    origine: 'correzione',
    testo: 'Porta la parete a 1,2 mm',
    titolo: 'Correzione: parete',
    modifiche: [{ chiave: 'telaio.sezioneSpessore', prima: 1, dopo: 1.2 }],
  },
  { id: 'varianti', tipo: 'varianti', testo: 'Proponi 3 varianti' },
  { id: 'prossimo', tipo: 'scrivi', testo: 'Prepara per la pressofusione', bozza: 'Prepara…' },
];

beforeEach(() => {
  setLanguage('it');
});
afterEach(() => {
  resetLanguageForTests();
});

describe('AssistantBriefCard', () => {
  it('should sum up the model in one card: family, key measures, facts, silhouette and assumptions', () => {
    render(<AssistantBriefCard scheda={scheda} chips={chips} onChip={vi.fn()} />);
    const card = screen.getByRole('region', { name: 'Il modello' });
    expect(within(card).getByRole('heading', { name: 'Fibbia · rettangolare' })).toBeInTheDocument();
    expect(within(card).getByText('Da foto')).toBeInTheDocument();
    expect(within(card).getByText('3 × 2,5 mm')).toBeInTheDocument();
    expect(
      within(card).getByText('Zama ≈ 4,5 g · 27 × 18 × 5,6 mm · sagoma 0,94 · 2 ipotesi da controllare'),
    ).toBeInTheDocument();
  });

  it('should offer three next steps with a single filled button, and hand the clicked one over', async () => {
    const user = userEvent.setup();
    const onChip = vi.fn();
    render(<AssistantBriefCard scheda={scheda} chips={chips} onChip={onChip} />);
    const passi = within(screen.getByRole('group', { name: 'Prossimi passi' })).getAllByRole('button');
    expect(passi.map((passo) => passo.textContent)).toEqual([
      'Porta la parete a 1,2 mm',
      'Proponi 3 varianti',
      'Prepara per la pressofusione',
    ]);
    // Only the first is the filled (Sinopia red) action.
    expect(passi.filter((passo) => passo.className.includes('primary-action'))).toHaveLength(1);
    await user.click(passi[1]!);
    expect(onChip).toHaveBeenCalledExactlyOnceWith(chips[1]);
  });

  it('should keep every step waiting while one is applied', () => {
    render(<AssistantBriefCard scheda={scheda} chips={chips} chipInCorso='correzione-PARETE_MIN' onChip={vi.fn()} />);
    const passi = within(screen.getByRole('group', { name: 'Prossimi passi' })).getAllByRole('button');
    expect(passi.every((passo) => (passo as HTMLButtonElement).disabled)).toBe(true);
    expect(passi[0]).toHaveAttribute('aria-busy', 'true');
  });

  it('should say the checks are running, unavailable or clean', () => {
    const { rerender } = render(
      <AssistantBriefCard scheda={scheda} controlli={{ stato: 'caricamento' }} chips={[]} onChip={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Controllo la producibilità…');
    rerender(<AssistantBriefCard scheda={scheda} controlli={{ stato: 'errore' }} chips={[]} onChip={vi.fn()} />);
    expect(screen.getByText('Il controllo di producibilità non è disponibile ora.')).toBeInTheDocument();
    rerender(
      <AssistantBriefCard scheda={scheda} controlli={{ stato: 'pronto', righe: [] }} chips={[]} onChip={vi.fn()} />,
    );
    expect(screen.getByText('Producibilità: niente da segnalare')).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('should list two outcomes to check, each selecting its piece, then how many more', async () => {
    const user = userEvent.setup();
    const onSelezionaPezzo = vi.fn();
    render(
      <AssistantBriefCard
        scheda={scheda}
        controlli={{
          stato: 'pronto',
          righe: [
            { id: '1', testo: 'Telaio: parete 1 mm, minimo 1,2 mm', livello: 'blocco', pezzo: 'Telaio' },
            { id: '2', testo: 'Ardiglione: ardiglione 1,6 mm, minimo 1,8 mm', livello: 'avviso', pezzo: 'Ardiglione' },
            { id: '3', testo: 'Raccordo ridotto', livello: 'avviso' },
          ],
        }}
        chips={chips}
        onChip={vi.fn()}
        onSelezionaPezzo={onSelezionaPezzo}
      />,
    );
    expect(screen.getByText('Da controllare')).toBeInTheDocument();
    expect(screen.queryByText('Raccordo ridotto')).not.toBeInTheDocument();
    expect(screen.getByText('+ 1 altra')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Telaio: parete 1 mm, minimo 1,2 mm' }));
    expect(onSelezionaPezzo).toHaveBeenCalledExactlyOnceWith('Telaio');
  });
});
