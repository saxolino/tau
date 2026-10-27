import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExportFile } from '@taucad/types/constants';
import { materiali } from '@taucad/smlib/famiglie';
import { setLanguage } from '#i18n/language.js';
import { bindTranslate } from '#i18n/translate.js';
import type { PezzoDellaConsegna } from '#lib/consegna.js';
import type { PreparedExport } from '#services/project-export.types.js';
import type { ProjectExportRows } from '#services/project-export.js';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';
import { ProjectDeliverySection } from '#routes/w.$workspace.$project/project-delivery-section.js';
import { toast } from '#components/ui/sonner.js';

const state = vi.hoisted(() => ({
  link: undefined as unknown,
  columns: true,
  cadInbox: true,
  save: vi.fn(),
  quote: vi.fn(),
  suppliers: vi.fn(),
}));
vi.mock('#hooks/use-sinopia-cad-sync.js', () => ({ useSinopiaCadLink: () => state.link }));
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'local' }) }));
vi.mock('#hooks/use-sinopia-send-events.js', () => ({
  useSinopiaSendEvents: () => ({
    events: [{ kind: 'sent', id: 'a', createdAt: 1, versionNumber: 3 }],
    error: undefined,
  }),
}));
vi.mock('#components/ui/sonner.js', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('#services/sinopia-consegna.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#services/sinopia-consegna.js')>()),
  libreriaConFileCad: async () => state.columns,
  salvaInLibreria: state.save,
  chiediPreventivo: state.quote,
  fornitoriPerTipo: state.suppliers,
  allegatiCadAmmessi: async () => state.cadInbox,
}));

const link: SinopiaCadLink = {
  modelId: '30000000-0000-4000-8000-000000000001',
  projectId: '20000000-0000-4000-8000-000000000001',
  userId: '10000000-0000-4000-8000-000000000001',
  baseRevisionId: null,
};
const step = createExportFile('step', 'model', new Uint8Array([1]));
const glb = createExportFile('glb', 'model', new Uint8Array([2]));
const photo = createExportFile('png', 'preview', new Uint8Array([3]));
const sheet = { name: 'Fibbia.pdf', bytes: new Uint8Array([4]), mimeType: 'application/pdf' };
const rows: ProjectExportRows = {
  step: {
    status: 'verified',
    files: [step],
    measured: {
      size: [44, 32, 3],
      pieces: [{ name: 'Telaio', size: [44, 32, 3], volumeMm3: 1200 }],
    },
  },
  glb: { status: 'ready', files: [glb] },
  pdf: { status: 'ready', files: [sheet] },
};
const pieces: PezzoDellaConsegna[] = [
  {
    nome: 'Telaio',
    componentId: 'c1',
    volumeMm3: 1200,
    materiale: materiali['ottone']!,
    processo: 'tranciatura_lamiera',
    pietra: false,
    pesoGrammi: 10.2,
    piano: true,
  },
];
const capture = vi.fn(async (): Promise<PreparedExport> => ({ status: 'ready', files: [photo] }));

const mount = (withRows: ProjectExportRows = rows): void => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectDeliverySection
        name='Fibbia Riviera'
        rows={withRows}
        selectedNames={undefined}
        capture={capture}
        pieces={pieces}
        partType='buckle'
      />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  setLanguage('it');
  state.link = link;
  state.columns = true;
  state.cadInbox = true;
  state.save.mockResolvedValue('70000000-0000-4000-8000-000000000007');
  state.quote.mockResolvedValue({ conversazione: '60000000-0000-4000-8000-000000000006', stepAllegato: true });
  state.suppliers.mockResolvedValue([
    {
      id: '50000000-0000-4000-8000-000000000005',
      nome: 'Minuterie Brenta',
      luogo: 'Stra, IT',
      prodotti: 2,
      demo: false,
    },
  ]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Open the quote panel, pick the supplier and send; returns the toast's text. */
const sendQuote = async (): Promise<string> => {
  const t = bindTranslate('it');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: t('consegna.quote.ask') }));
  await user.click(await screen.findByRole('radio'));
  await user.type(screen.getByRole('textbox', { name: t('consegna.quote.quantity') }), '500');
  await user.click(screen.getByRole('button', { name: t('consegna.quote.review') }));
  await user.click(screen.getByRole('button', { name: t('consegna.quote.send', { supplier: 'Minuterie Brenta' }) }));
  await waitFor(() => {
    expect(toast.success).toHaveBeenCalledOnce();
  });
  return vi.mocked(toast.success).mock.calls[0]![0] as string;
};

describe('the STEP promise follows what really travels (revisione 11)', () => {
  it('should promise the STEP and say it went when the server took it', async () => {
    const t = bindTranslate('it');
    mount();
    await screen.findByText(t('consegna.quote.ask'));
    const sent = sendQuote();
    expect(await screen.findByText(t('consegna.quote.attachmentsWithStep'))).toBeInTheDocument();
    expect(await sent).toBe(t('consegna.quote.sentWithStep', { supplier: 'Minuterie Brenta' }));
  });

  it('should say the STEP stayed behind when the server refused it', async () => {
    const t = bindTranslate('it');
    state.quote.mockResolvedValue({ conversazione: '60000000-0000-4000-8000-000000000006', stepAllegato: false });
    mount();
    expect(await sendQuote()).toBe(t('consegna.quote.sentWithoutStep', { supplier: 'Minuterie Brenta' }));
  });

  it('should not promise a STEP over 10 MB, nor one the inbox does not admit', async () => {
    const t = bindTranslate('it');
    const user = userEvent.setup();
    state.quote.mockResolvedValue({ conversazione: '60000000-0000-4000-8000-000000000006', stepAllegato: false });
    const big = createExportFile('step', 'model', new Uint8Array(10_485_761));
    mount({
      ...rows,
      step: {
        status: 'verified',
        files: [big],
        measured: rows.step?.status === 'verified' ? rows.step.measured! : undefined!,
      },
    });
    await user.click(screen.getByRole('button', { name: t('consegna.quote.ask') }));
    expect(await screen.findByText(t('consegna.quote.attachments'))).toBeInTheDocument();
    expect(screen.queryByText(t('consegna.quote.attachmentsWithStep'))).not.toBeInTheDocument();
    await user.click(await screen.findByRole('radio'));
    await user.type(screen.getByRole('textbox', { name: t('consegna.quote.quantity') }), '500');
    await user.click(screen.getByRole('button', { name: t('consegna.quote.review') }));
    await user.click(screen.getByRole('button', { name: t('consegna.quote.send', { supplier: 'Minuterie Brenta' }) }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(toast.success).mock.calls[0]![0]).toBe(t('consegna.quote.sent', { supplier: 'Minuterie Brenta' }));
    cleanup();
    vi.mocked(toast.success).mockClear();
    state.cadInbox = false;
    mount();
    await user.click(screen.getByRole('button', { name: t('consegna.quote.ask') }));
    expect(await screen.findByText(t('consegna.quote.attachments'))).toBeInTheDocument();
  });
});

describe('Consegna inside Esporta (E3a)', () => {
  it('should save the part to the Library with the verified STEP, the GLB, the photo and the plan size', async () => {
    const t = bindTranslate('it');
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: t('consegna.library.save') }));
    await waitFor(() => {
      expect(state.save).toHaveBeenCalledOnce();
    });
    expect(capture).toHaveBeenCalledOnce();
    expect(state.save).toHaveBeenCalledWith(
      expect.objectContaining({
        link,
        step,
        glb,
        foto: photo,
        nome: 'Fibbia Riviera',
        tipo: 'buckle',
        materiale: { chiave: 'ottone', nome: 'Ottone', colore: materiali['ottone']!.colore },
        // A flat part: width and height in plan.
        larghezza: 44,
        altezza: 32,
        ingombro: [44, 32, 3],
        pezzi: [{ nome: 'Telaio', materiale: 'ottone', processo: 'tranciatura_lamiera', pesoGrammi: 10.2 }],
      }),
    );
  });

  it('should ask a supplier of the part type for a quote with the sheet and the photo attached', async () => {
    const t = bindTranslate('it');
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: t('consegna.quote.ask') }));
    expect(screen.getByRole('combobox', { name: t('consegna.quote.type') })).toHaveValue('buckle');
    const supplier = await screen.findByRole('radio');
    expect(state.suppliers).toHaveBeenCalledWith('buckle');
    expect(screen.getByText('Minuterie Brenta')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('consegna.quote.review') })).toBeDisabled();
    await user.click(supplier);
    // No quantity, no request: the panel asks for it.
    expect(screen.getByText(t('consegna.quote.needsQuantity'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('consegna.quote.review') })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: t('consegna.quote.quantity') }), '500');
    await user.type(screen.getByRole('textbox', { name: t('consegna.quote.finish') }), 'galvanica oro');
    await user.type(screen.getByRole('textbox', { name: t('consegna.quote.tolerances') }), '±0,1 mm sul perno');
    // The summary is shown first and nothing leaves until it is confirmed.
    await user.click(screen.getByRole('button', { name: t('consegna.quote.review') }));
    const riepilogo = within(screen.getByRole('region', { name: t('consegna.quote.summary') }));
    expect(riepilogo.getByText(/Finitura: galvanica oro\. Tolleranze: ±0,1 mm sul perno\./u)).toBeInTheDocument();
    expect(riepilogo.getByText(/Producibilità/u)).toBeInTheDocument();
    expect(riepilogo.getByText(/Non verificata/u)).toBeInTheDocument();
    expect(state.quote).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: t('consegna.quote.send', { supplier: 'Minuterie Brenta' }) }));
    await waitFor(() => {
      expect(state.quote).toHaveBeenCalledOnce();
    });
    const [request] = state.quote.mock.calls[0] as [
      { fornitoreId: string; testo: (stepAllegato: boolean) => string; file: unknown[]; step?: { name: string } },
    ];
    expect(request.fornitoreId).toBe('50000000-0000-4000-8000-000000000005');
    expect(request.file).toEqual([sheet, photo]);
    // The verified STEP goes along, named after the project; the text says whether it travelled.
    expect(request.step).toMatchObject({ name: 'Fibbia Riviera.step', mimeType: 'application/step' });
    const senza = request.testo(false);
    expect(senza).toContain('Richiesta di preventivo · Fibbia · progetto «Fibbia Riviera»');
    expect(senza).toContain('Quantità: 500 pz');
    expect(senza).toContain('· Telaio — Ottone — Tranciatura lamiera — 44 × 32 × 3 mm — 10,2 g');
    expect(senza).toContain('Insieme: 44 × 32 × 3 mm — 10,2 g');
    expect(senza).toContain('Finitura: galvanica oro. Tolleranze: ±0,1 mm sul perno.');
    expect(senza).toContain('STEP e GLB nella versione 3');
    const con = request.testo(true);
    expect(con).toContain('Allegati: Fibbia.pdf, preview.png, Fibbia Riviera.step.');
    expect(con).toContain('Lo STEP allegato è quello verificato da SinopiaCAD');
  });

  it('should hide «Salva in Libreria» without the Library columns and say how to link an unlinked model', async () => {
    const t = bindTranslate('it');
    state.columns = false;
    mount();
    const section = within(screen.getByRole('region', { name: t('consegna.title') }));
    await waitFor(() => {
      expect(section.queryByRole('button', { name: t('consegna.library.save') })).not.toBeInTheDocument();
    });
    cleanup();
    state.link = undefined;
    state.columns = true;
    mount();
    expect(screen.getByRole('button', { name: t('consegna.quote.ask') })).toBeDisabled();
    expect(screen.getByText(t('consegna.quote.unlinked'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('consegna.library.save') })).not.toBeInTheDocument();
  });
});
