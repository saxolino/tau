import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fibbia } from '@taucad/smlib/famiglie';
import type { EsitoVarianti } from '@taucad/smlib/varianti';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { AgentVariantsBlock, AssistantTrayContext } from '#components/chat/assistant-tray.js';
import type { AssistantTrayValue } from '#components/chat/assistant-tray.js';
import type { ModelloAssistente } from '#hooks/use-assistant-model.js';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import type { BloccoVarianti } from '#lib/assistant-variants-marker.js';

vi.mock('#services/varianti-worker.js', () => ({
  prendiValutatoreVarianti: vi.fn(),
  chiudiValutatoreVarianti: vi.fn(),
}));

const parametri = fibbia.predefiniti('rettangolare');
const modello: ModelloAssistente = {
  pieces: [],
  materials: {},
  nome: 'Fibbia',
  entryPath: 'main.ts',
  valori: {},
  famiglia: { definizione: fibbia, variante: 'rettangolare', parametri },
  bloccati: [],
  ipotesi: 0,
  controllo: { stato: 'nessuno' },
};
const esito: EsitoVarianti = {
  attuale: { esiti: [], pesoGrammi: 4.5, millisecondi: 10 },
  varianti: [
    {
      id: 'agente-1',
      origine: 'agente',
      titolo: 'Più leggera',
      motivo: 'Sezione più sottile.',
      parametri: { ...parametri, telaio: { ...parametri.telaio, sezioneLarghezza: 2.2 } },
      differenze: [{ chiave: 'telaio.sezioneLarghezza', unita: 'mm', prima: 3, dopo: 2.2, variazione: -0.27 }],
      esiti: [],
      pesoGrammi: 3.6,
      millisecondi: 10,
      nuoviBlocchi: 0,
    },
  ],
};

const tray = (sovrascrivi: Partial<AssistantTrayValue> = {}): AssistantTrayValue => ({
  modello,
  annullamento: false,
  apriVarianti: vi.fn(async () => undefined),
  chiudiVarianti: vi.fn(),
  scartaVariante: vi.fn(),
  valutaInsiemi: vi.fn(async () => esito),
  usaVariante: vi.fn(async () => true),
  applicaModifiche: vi.fn(async () => true),
  annullaModifica: vi.fn(async () => undefined),
  chiudiModifica: vi.fn(),
  selezionaPezzo: vi.fn(),
  ...sovrascrivi,
});

const renderBlocco = (blocco: BloccoVarianti, valore: AssistantTrayValue) =>
  render(
    <TooltipProvider>
      <AssistantTrayContext.Provider value={valore}>
        <AgentVariantsBlock blocco={blocco} />
      </AssistantTrayContext.Provider>
    </TooltipProvider>,
  );

const pronto: BloccoVarianti = {
  stato: 'pronto',
  famiglia: 'fibbia',
  insiemi: [
    { titolo: 'Più leggera', motivo: 'Sezione più sottile.', parametri: { telaio: { sezioneLarghezza: 2.2 } } },
  ],
};

beforeEach(() => {
  setLanguage('it');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
});
afterEach(() => {
  resetLanguageForTests();
  vi.unstubAllGlobals();
});

describe('AgentVariantsBlock', () => {
  it('should wait while the answer streams, without evaluating anything', () => {
    const valore = tray();
    renderBlocco({ stato: 'in_corso' }, valore);
    expect(screen.getByRole('status')).toHaveTextContent('L’assistente prepara le varianti…');
    expect(valore.valutaInsiemi).not.toHaveBeenCalled();
  });

  it('should evaluate the agent’s sets on this model and apply the chosen one only on «Usa questa»', async () => {
    const user = userEvent.setup();
    const valore = tray();
    renderBlocco(pronto, valore);
    expect(await screen.findByText('Sezione più sottile.')).toBeInTheDocument();
    expect(valore.valutaInsiemi).toHaveBeenCalledExactlyOnceWith(pronto.insiemi);
    expect(screen.getByText('Dall’assistente')).toBeInTheDocument();
    expect(screen.getByText('3 mm → 2,2 mm')).toBeInTheDocument();
    expect(screen.getByText('4,5 g → 3,6 g')).toBeInTheDocument();
    expect(valore.usaVariante).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Usa questa' }));
    expect(valore.usaVariante).toHaveBeenCalledExactlyOnceWith(esito.varianti[0], 'Più leggera');
    // Applied, the card leaves: «Cosa ho cambiato» takes over in the tray.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /Varianti/u })).not.toBeInTheDocument();
    });
  });

  it('should say when the block cannot be used: unreadable, another family, a free model', () => {
    const valore = tray();
    const { unmount } = renderBlocco({ stato: 'non_valido' }, valore);
    expect(screen.getByText(/non si leggono/u)).toBeInTheDocument();
    unmount();
    const altra = renderBlocco({ ...pronto, famiglia: 'tacco' }, valore);
    expect(screen.getByText('Le varianti dell’assistente sono per un’altra famiglia (Tacco).')).toBeInTheDocument();
    altra.unmount();
    const { famiglia: _famiglia, ...libero } = modello;
    renderBlocco(pronto, tray({ modello: libero }));
    expect(screen.getByText(/questo è un pezzo libero/u)).toBeInTheDocument();
  });

  it('should offer to try again when the worker fails', async () => {
    const user = userEvent.setup();
    const valutaInsiemi = vi.fn<AssistantTrayValue['valutaInsiemi']>().mockRejectedValueOnce(new Error('kernel'));
    valutaInsiemi.mockResolvedValueOnce(esito);
    renderBlocco(pronto, tray({ valutaInsiemi }));
    await user.click(await screen.findByRole('button', { name: 'Riprova' }));
    expect(await screen.findByText('Sezione più sottile.')).toBeInTheDocument();
    expect(valutaInsiemi).toHaveBeenCalledTimes(2);
  });
});
