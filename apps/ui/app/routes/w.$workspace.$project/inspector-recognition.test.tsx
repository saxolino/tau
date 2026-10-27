// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schedaParteDiProva, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { progettoRiconosciuto } from '#services/riconoscimento-progetto.js';
import { leggiRecordRiconoscimento } from '#services/riconoscimento-record.js';

const root = '/projects/proj_1';
const files = new Map<string, Uint8Array<ArrayBuffer>>();
const commitValue = vi.fn(async () => ({ status: 'committed' as const }));
const selezione = vi.hoisted(() => ({ kind: 'model' as 'model' | 'piece' }));

vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'proj_1', mainEntryPath: 'main.ts' }) }));
vi.mock('#hooks/use-inspector-selection.js', () => ({
  useInspectorSelection: () => ({ selection: { kind: selezione.kind, pieceCount: 2 } }),
}));
vi.mock('#hooks/use-file-manager.js', () => ({
  useFileManager: () => ({
    parameterFiles: {
      exists: async (path: string) => files.has(path),
      readFile: async (path: string) => files.get(path)!,
      writeFileChecked: async ({
        path,
        data,
        preconditions,
      }: {
        path: string;
        data: string;
        preconditions: ReadonlyArray<{ path: string; expected: Uint8Array | null }>;
      }) => {
        const attuale = files.get(path);
        const atteso = preconditions[0]?.expected;
        if (atteso && attuale && new TextDecoder().decode(atteso) !== new TextDecoder().decode(attuale)) {
          return { status: 'conflict', conflicts: [] };
        }
        const content = new TextEncoder().encode(data);
        files.set(path, content);
        return { status: 'applied', content };
      },
    },
  }),
}));
vi.mock('#routes/w.$workspace.$project/chat-parameters.js', () => ({
  useProjectParametersSource: () => ({
    useEntry: () => ({
      manifest: { defaults: {} },
      entry: { activeGroup: 'default', groups: { default: { values: {} } } },
    }),
    commitValue,
  }),
}));

const { InspectorRecognition } = await import('#routes/w.$workspace.$project/inspector-recognition.js');

const testo = (bytes: Uint8Array | undefined): string => new TextDecoder().decode(bytes);

beforeEach(() => {
  setLanguage('it');
  selezione.kind = 'model';
  files.clear();
  commitValue.mockClear();
  const progetto = progettoRiconosciuto({
    scheda: schedaRiconoscimentoDiProva,
    schedaParte: schedaParteDiProva,
    immagine: { bytes: new Uint8Array([1]), tipo: 'image/png' },
    lingua: 'it',
  })!;
  for (const [path, file] of Object.entries(progetto.files)) {
    files.set(`${root}/${path}`, file.content);
  }
});
afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('recognition in the inspector', () => {
  it('should show the card of a model built from a photo, only while the whole model is selected', async () => {
    const { rerender } = render(<InspectorRecognition />);
    expect(await screen.findByRole('heading', { name: 'Fibbia · rettangolare' })).toBeVisible();
    expect(screen.getByText('Domanda 1 di 1')).toBeVisible();
    selezione.kind = 'piece';
    rerender(<InspectorRecognition />);
    expect(screen.queryByRole('heading', { name: 'Fibbia · rettangolare' })).toBeNull();
  });

  it('should lock the answer in the parameters, drop its assumption from main.ts and record it, then ask nothing more', async () => {
    const user = userEvent.setup();
    render(<InspectorRecognition />);
    const chip = await screen.findByRole('group', { name: 'Cinturino · larghezza' });
    expect(testo(files.get(`${root}/main.ts`))).toContain(`"cinturino.larghezza": '[c=0.52 f=proporzione`);
    await user.click(within(chip).getByRole('button', { name: '20 mm' }));
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Cinturino · larghezza' })).toBeNull();
    });
    expect(commitValue).toHaveBeenCalledWith('main.ts', expect.anything(), {
      pointer: '/cinturino/larghezza',
      value: 20,
      group: 'default',
    });
    const main = testo(files.get(`${root}/main.ts`));
    expect(main).not.toContain('"cinturino.larghezza"');
    expect(main).toContain('cinturino: { larghezza: 20');
    const lettura = leggiRecordRiconoscimento(files.get(`${root}/.tau/workbench/riconoscimento.json`));
    expect(lettura).toMatchObject({
      stato: 'ok',
      record: {
        risposte: { 'cinturino.larghezza': 20 },
        mainScritto: main,
        verifica: { stato: 'non_disponibile', motivo: 'modulo_assente' },
        cronologia: [{ iou: null, parametri: { 'cinturino.larghezza': 20 } }],
      },
    });
    expect(screen.getByText('tuo valore')).toBeVisible();
  });

  it('should leave main.ts alone when someone else changed it since the recognition wrote it', async () => {
    const user = userEvent.setup();
    files.set(`${root}/main.ts`, new TextEncoder().encode('// edited by the agent\n'));
    render(<InspectorRecognition />);
    const chip = await screen.findByRole('group', { name: 'Cinturino · larghezza' });
    await user.click(within(chip).getByRole('button', { name: '19 mm' }));
    await waitFor(() => {
      expect(commitValue).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Cinturino · larghezza' })).toBeNull();
    });
    expect(testo(files.get(`${root}/main.ts`))).toBe('// edited by the agent\n');
  });
});
