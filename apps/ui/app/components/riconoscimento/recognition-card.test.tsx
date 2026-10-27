// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { catalogoFamiglie, prossimaDomanda, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import { ChipDomanda, etichettaParametro, RecognitionCard } from '#components/riconoscimento/recognition-card.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

const fibbia = catalogoFamiglie().find((famiglia) => famiglia.id === 'fibbia')!;

beforeEach(() => {
  setLanguage('it');
});
afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('recognition card', () => {
  it('should say what was recognised, how it was seen and how sure each value is', () => {
    render(<RecognitionCard scheda={schedaRiconoscimentoDiProva} famiglia={fibbia} />);
    const card = screen.getByRole('region', { name: 'Riconosciuto' });
    expect(within(card).getByRole('heading', { name: 'Fibbia · rettangolare' })).toBeVisible();
    expect(
      within(card).getByText('vista di fronte · scala dal catalogo fornitori · verifica della sagoma non disponibile'),
    ).toBeVisible();
    const righe = card.querySelectorAll('[data-slot=recognition-parameter]');
    // In the family's order, not the classifier's.
    expect([...righe].map((riga) => riga.querySelector('span')?.textContent)).toStrictEqual([
      'Cinturino · larghezza',
      'Telaio · altezza interna',
      'Telaio · sezione larghezza',
      'Telaio · sezione spessore',
      'Telaio · raggio angoli',
      'Telaio · profilo',
      'Ardiglione · diametro',
    ]);
    expect([...righe].map((riga) => (riga as HTMLElement).dataset['state'])).toStrictEqual([
      'ipotesi',
      'stimata',
      'misurata',
      'ipotesi',
      'stimata',
      'stimata',
      'ipotesi',
    ]);
    expect(within(card).getByText('ipotesi ○ 0,52')).toBeVisible();
    expect(within(card).getByText('stimata ◐ 0,72')).toBeVisible();
    expect(within(card).getByText('19 mm')).toBeVisible();
    // The plausible band of the photo, on the recipe's range.
    expect(card.querySelectorAll('[data-slot=recognition-band]')).toHaveLength(5);
    expect(within(card).getByText('6 ipotesi da controllare')).toBeVisible();
  });

  it('should show the designer’s answers as theirs, with the lock and no band', () => {
    render(
      <RecognitionCard
        scheda={schedaRiconoscimentoDiProva}
        famiglia={fibbia}
        risposte={{ 'cinturino.larghezza': 20 }}
      />,
    );
    const riga = document.querySelector('[data-slot=recognition-parameter][data-state=yours]')!;
    expect(within(riga as HTMLElement).getByText('tuo valore')).toBeVisible();
    expect(within(riga as HTMLElement).getByText('20 mm')).toBeVisible();
    expect(riga.querySelector('[data-slot=recognition-band]')).toBeNull();
    expect(screen.getByText('5 ipotesi da controllare')).toBeVisible();
  });

  it('should ask one question at a time with three proposals and «Altro…», and hand back the answer', async () => {
    const user = userEvent.setup();
    const onRisposta = vi.fn();
    const domanda = prossimaDomanda(schedaRiconoscimentoDiProva, fibbia, { risposte: new Set() })!;
    render(
      <RecognitionCard
        scheda={schedaRiconoscimentoDiProva}
        famiglia={fibbia}
        domanda={domanda}
        posizioneDomanda={{ corrente: 1, totale: 1 }}
        onRisposta={onRisposta}
      />,
    );
    const chip = screen.getByRole('group', { name: 'Cinturino · larghezza' });
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(within(chip).getByText('Domanda 1 di 1')).toBeVisible();
    expect(within(chip).getByText('Il cinturino è in parte coperto: quanto è largo?')).toBeVisible();
    expect(
      within(chip)
        .getAllByRole('button')
        .map((bottone) => bottone.textContent),
    ).toStrictEqual(['18 mm', '19 mm', '20 mm', 'Altro…']);
    await user.click(within(chip).getByRole('button', { name: '20 mm' }));
    expect(onRisposta).toHaveBeenLastCalledWith({ tipo: 'parametro', chiave: 'cinturino.larghezza', valore: 20 });
    await user.click(within(chip).getByRole('button', { name: 'Altro…' }));
    await user.type(within(chip).getByRole('textbox', { name: 'Un altro valore' }), '21,5');
    await user.click(within(chip).getByRole('button', { name: 'Conferma' }));
    expect(onRisposta).toHaveBeenLastCalledWith({ tipo: 'parametro', chiave: 'cinturino.larghezza', valore: 21.5 });
  });

  it('should ask the family with the alternatives and «Altro…» for a free piece, and a known measure for the scale', async () => {
    const user = userEvent.setup();
    const onRisposta = vi.fn();
    const { unmount } = render(
      <ChipDomanda
        domanda={{ tipo: 'famiglia', opzioni: ['tacco', 'fondo_semplice', 'libero'] }}
        onRisposta={onRisposta}
      />,
    );
    expect(screen.getAllByRole('button').map((bottone) => bottone.textContent)).toStrictEqual([
      'Tacco',
      'Fondo',
      'Altro…',
    ]);
    await user.click(screen.getByRole('button', { name: 'Fondo' }));
    expect(onRisposta).toHaveBeenLastCalledWith({ tipo: 'famiglia', famiglia: 'fondo_semplice' });
    unmount();
    render(<ChipDomanda domanda={{ tipo: 'scala' }} onRisposta={onRisposta} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Che cosa misura' }), 'altezza');
    await user.type(screen.getByRole('textbox', { name: 'Un altro valore' }), '85');
    await user.click(screen.getByRole('button', { name: 'Conferma' }));
    expect(onRisposta).toHaveBeenLastCalledWith({ tipo: 'scala', valoreMm: 85, cosa: 'altezza' });
  });

  it('should label dotted keys by piece and measure', () => {
    expect(etichettaParametro('tacco.altezza', 'it')).toBe('Tacco · altezza');
    expect(etichettaParametro('seduta.lunghezzaPosteriore', 'it')).toBe('Seduta · lunghezza posteriore');
    expect(etichettaParametro('note', 'en')).toBe('Note');
  });
});
