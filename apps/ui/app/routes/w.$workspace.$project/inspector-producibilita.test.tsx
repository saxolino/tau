/* eslint-disable @typescript-eslint/naming-convention -- process keys are the engine's snake_case ids. */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlloProducibilita } from '@taucad/smlib/producibilita';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import { bindTranslate } from '#i18n/translate.js';
import type { Producibilita } from '#routes/w.$workspace.$project/producibilita-context.js';
import { ProducibilitaSectionView } from '#routes/w.$workspace.$project/inspector-producibilita.js';
import { ProducibilityExportGate } from '#routes/w.$workspace.$project/producibility-export-gate.js';

afterEach(() => {
  cleanup();
  resetLanguageForTests();
});

const controllo = (
  codice: string,
  livello: ControlloProducibilita['livello'],
  extra: Partial<ControlloProducibilita> = {},
): ControlloProducibilita => ({
  id: `${codice}|${extra.pezzo ?? 'Telaio'}`,
  codice,
  livello,
  pezzo: 'Telaio',
  messaggio: `${codice} ${livello}`,
  fonti: ['geometria'],
  ...extra,
});

const controlli: ControlloProducibilita[] = [
  controllo('SOLIDO_CHIUSO', 'ok'),
  controllo('PARETE_MIN', 'blocco', {
    valore: 0.42,
    soglia: 1.2,
    unita: 'mm',
    evidenza: 'facce',
    facce: [{ faccia: 2, livello: 'blocco' }],
  }),
  controllo('SFORMO', 'avviso', { valore: 0, soglia: 1, unita: 'deg', evidenza: 'sformo', conteggio: 4 }),
  controllo('SOTTOSQUADRO', 'ok', { valore: 0, unita: 'n', evidenza: 'sformo', conteggio: 0 }),
  controllo('ARDIGLIONE_D', 'ok', { pezzo: 'Ardiglione', valore: 2.5, soglia: 1.8, fonti: ['famiglia'] }),
  {
    ...controllo('LUCE_CINTURINO', 'avviso', { valore: 3, fonti: ['famiglia'] }),
    id: 'LUCE_CINTURINO|',
    pezzo: undefined,
  },
];

const producibilita = (extra: Partial<Producibilita> = {}): Producibilita => ({
  stato: 'pronto',
  controlli,
  blocchi: controlli.filter(({ livello }) => livello === 'blocco'),
  pezzi: [
    {
      nome: 'Telaio',
      componentId: 'c:telaio',
      processo: 'pressofusione_zama',
      scelto: false,
      materiale: 'zama',
      pietra: false,
    },
    {
      nome: 'Ardiglione',
      componentId: 'c:ardiglione',
      processo: 'cnc',
      scelto: false,
      materiale: 'acciaio',
      pietra: false,
    },
  ],
  direzione: 'z',
  artifactKey: 'render-1',
  aggiornati: true,
  famiglia: { id: 'fibbia', versione: 1, variante: 'rettangolare' },
  tempi: undefined,
  focus: undefined,
  setFocus: vi.fn(),
  setProcesso: vi.fn(),
  setDirezione: vi.fn(),
  riprova: vi.fn(),
  registraScelta: vi.fn(async () => undefined),
  ...extra,
});

const renderSection = (value: Producibilita, pezzo?: string): void => {
  render(
    <TooltipProvider>
      <ProducibilitaSectionView producibilita={value} pezzoSelezionato={pezzo} />
    </TooltipProvider>,
  );
};

describe.each<Language>(['it', 'en'])('producibility section in %s', (language) => {
  it('should show the selected piece’s process and checks with their measured value against the minimum', () => {
    setLanguage(language);
    const t = bindTranslate(language);
    renderSection(producibilita(), 'Telaio');
    const section = within(screen.getByRole('region', { name: t('producibilita.title') }));
    expect(section.getByRole('status')).toHaveTextContent(t('producibilita.summary.blocksOne'));
    expect(
      section.getByRole('combobox', { name: t('producibilita.processOf', { piece: 'Telaio' }) }),
    ).toHaveTextContent(t('producibilita.processes.pressofusione_zama'));
    const parete = section.getByRole('button', { name: new RegExp(t('producibilita.codes.PARETE_MIN')) });
    expect(parete).toHaveTextContent(language === 'it' ? '0,42 mm · min 1,2' : '0.42 mm · min 1.2');
    expect(parete).toHaveAttribute('aria-pressed', 'false');
    expect(section.getByRole('button', { name: new RegExp(t('producibilita.codes.SFORMO')) })).toHaveTextContent(
      `${t('producibilita.values.deg', { value: '0', minimum: '1' })} · ${t('producibilita.values.faces', { count: 4 })}`,
    );
    // The selected piece shows every check, passed ones too; the other piece's are not there.
    expect(section.getByText(t('producibilita.codes.SOLIDO_CHIUSO'))).toBeInTheDocument();
    expect(section.queryByText(t('producibilita.codes.ARDIGLIONE_D'))).not.toBeInTheDocument();
    // The mould's pull direction is offered for zamak.
    expect(section.getByRole('combobox', { name: t('producibilita.direction') })).toBeInTheDocument();
  });

  it('should show a check on the model when clicked, and hide it when clicked again', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    const setFocus = vi.fn();
    const { rerender } = render(
      <TooltipProvider>
        <ProducibilitaSectionView producibilita={producibilita({ setFocus })} pezzoSelezionato='Telaio' />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: new RegExp(t('producibilita.codes.PARETE_MIN')) }));
    expect(setFocus).toHaveBeenCalledExactlyOnceWith('PARETE_MIN|Telaio');
    rerender(
      <TooltipProvider>
        <ProducibilitaSectionView
          producibilita={producibilita({ setFocus, focus: 'PARETE_MIN|Telaio' })}
          pezzoSelezionato='Telaio'
        />
      </TooltipProvider>,
    );
    const parete = screen.getByRole('button', { name: new RegExp(t('producibilita.codes.PARETE_MIN')) });
    expect(parete).toHaveAttribute('aria-pressed', 'true');
    // In focus, the check says what it found in words.
    expect(parete).toHaveTextContent('PARETE_MIN blocco');
    await user.click(parete);
    expect(setFocus).toHaveBeenLastCalledWith(undefined);
  });

  it('should list every piece for the model, folding passed checks, with the model’s own checks last', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    renderSection(producibilita());
    const pieces = screen
      .getAllByRole('combobox', { name: /./ })
      .filter((box) => box.getAttribute('aria-label') !== t('producibilita.direction'));
    expect(pieces).toHaveLength(2);
    // The frame's passed checks fold into one line until it is opened.
    expect(screen.queryByText(t('producibilita.codes.SOLIDO_CHIUSO'))).not.toBeInTheDocument();
    // A family check the geometry does not measure says what it is in its own words, and is not shown on the model.
    expect(screen.getByText('LUCE_CINTURINO avviso')).toBeInTheDocument();
    expect(screen.getByText(t('producibilita.model'))).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: `${t('producibilita.codes.SOLIDO_CHIUSO')} · ${t('producibilita.codes.SOTTOSQUADRO')}`,
      }),
    );
    expect(screen.getByText(t('producibilita.codes.SOLIDO_CHIUSO'))).toBeInTheDocument();
  });

  it('should say when the checks run and when the model is not an SMLib one', () => {
    setLanguage(language);
    const t = bindTranslate(language);
    renderSection(producibilita({ stato: 'in_corso', aggiornati: false, controlli: [], blocchi: [] }));
    expect(screen.getByRole('status')).toHaveTextContent(t('producibilita.checking'));
    cleanup();
    renderSection(producibilita({ stato: 'non_disponibile', controlli: [], blocchi: [] }));
    expect(screen.getByText(t('producibilita.unavailable'))).toBeInTheDocument();
  });
});

describe.each<Language>(['it', 'en'])('export soft block in %s', (language) => {
  it('should list the blocks and offer to fix them or to export anyway', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    const onFix = vi.fn();
    const onExportAnyway = vi.fn();
    const blocchi = controlli.filter(({ livello }) => livello === 'blocco');
    render(
      <ProducibilityExportGate
        isChecking={false}
        blocchi={blocchi}
        onFix={onFix}
        onExportAnyway={onExportAnyway}
        onOpenChange={vi.fn()}
      />,
    );
    const dialog = within(screen.getByRole('dialog', { name: t('producibilita.gate.title') }));
    expect(dialog.getByText(t('producibilita.gate.blocksOne'))).toBeInTheDocument();
    const list = within(dialog.getByRole('list', { name: t('producibilita.title') }));
    expect(list.getAllByRole('listitem')).toHaveLength(1);
    expect(
      list.getByText(t('producibilita.gate.item', { piece: 'Telaio', check: t('producibilita.codes.PARETE_MIN') })),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: t('producibilita.gate.exportAnyway') }));
    expect(onExportAnyway).toHaveBeenCalledOnce();
    await user.click(dialog.getByRole('button', { name: t('producibilita.gate.fix') }));
    expect(onFix).toHaveBeenCalledOnce();
  });

  it('should let the export go on without waiting while the checks run', async () => {
    setLanguage(language);
    const t = bindTranslate(language);
    const user = userEvent.setup();
    const onExportAnyway = vi.fn();
    render(
      <ProducibilityExportGate
        isChecking
        blocchi={[]}
        onFix={vi.fn()}
        onExportAnyway={onExportAnyway}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(t('producibilita.checking'));
    expect(screen.queryByRole('button', { name: t('producibilita.gate.fix') })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('producibilita.gate.exportWithoutWaiting') }));
    expect(onExportAnyway).toHaveBeenCalledOnce();
  });
});
