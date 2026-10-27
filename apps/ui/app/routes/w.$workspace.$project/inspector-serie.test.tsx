import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anello } from '@taucad/smlib/famiglie';
import type { RiepilogoSerie } from '@taucad/smlib/serie';
import { pianoSerie } from '@taucad/smlib/serie';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { SerieSectionView, TabellaSerie } from '#routes/w.$workspace.$project/inspector-serie.js';

const piano = pianoSerie({ famiglia: 'anello', variante: 'fascia', da: 13, a: 15, sistema: 'it' });
const riepilogo: RiepilogoSerie = {
  famiglia: 'anello',
  variante: 'fascia',
  asse: piano.asse,
  regole: piano.regole,
  righe: piano.voci.map((voce, indice) => ({
    valore: voce.valore,
    etichetta: voce.etichetta,
    nomeFile: voce.nomeFile,
    misure: voce.misure,
    volumeMm3: 200 + indice,
    pesoGrammi: 3.5 + indice * 0.1,
    esiti: [],
    costruita: true,
  })),
  millisecondi: 1,
};

beforeEach(() => {
  setLanguage('it');
});
afterEach(() => {
  resetLanguageForTests();
});

describe('Taglia e serie', () => {
  it('should show the ring size in the chosen system with the others as equivalents', async () => {
    render(
      <SerieSectionView
        modello={{ famiglia: 'anello', variante: 'griffe', parametri: anello.predefiniti('griffe') }}
        stato={{ stato: 'inattivo' }}
        intervallo={{ da: 8, a: 24 }}
        onIntervallo={vi.fn()}
        onCambiaTaglia={vi.fn()}
        onCalcola={vi.fn()}
      />,
    );
    expect(screen.getByText('IT 14 · EU 54 · US 7')).toBeInTheDocument();
    expect(screen.getByText('Diametro interno 17,19 mm · circonferenza 54 mm')).toBeInTheDocument();
  });

  it('should ask for the series and list the growth rules', async () => {
    const user = userEvent.setup();
    const onCalcola = vi.fn();
    render(
      <SerieSectionView
        modello={{ famiglia: 'anello', variante: 'griffe', parametri: anello.predefiniti('griffe') }}
        stato={{ stato: 'inattivo' }}
        intervallo={{ da: 8, a: 24 }}
        onIntervallo={vi.fn()}
        onCambiaTaglia={vi.fn()}
        onCalcola={onCalcola}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Calcola la serie' }));
    expect(onCalcola).toHaveBeenCalledOnce();
    expect(screen.getByText(/Spessore.*0,02 mm per ogni mm di diametro interno/u)).toBeInTheDocument();
  });

  it('should tabulate size, key measures and weight, marking the current size', () => {
    render(<TabellaSerie riepilogo={riepilogo} corrente={14} />);
    const righe = screen.getAllByRole('row');
    expect(righe).toHaveLength(4);
    const corrente = righe.find((riga) => riga.hasAttribute('data-corrente'))!;
    expect(within(corrente).getByRole('rowheader')).toHaveTextContent('IT 14');
    expect(corrente).toHaveTextContent('17,19');
    expect(corrente).toHaveTextContent('3,60 g');
  });
});
