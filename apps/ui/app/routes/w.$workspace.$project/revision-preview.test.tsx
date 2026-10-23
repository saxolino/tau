import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uint8ArrayToBase64 } from 'uint8array-extras';
import { projectToManifest, serializeProjectManifest } from '@taucad/types';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { decodeRevisionPreview, RevisionPreview } from '#routes/w.$workspace.$project/revision-preview.js';
import type { RevisionCard } from '#hooks/use-revisions.js';

const snapshot = vi.hoisted(() => vi.fn());
const pipeline = vi.hoisted(() => vi.fn());
vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: 'p' }) }));
vi.mock('#hooks/use-revision-status.js', () => ({ useRevisionClient: () => ({ snapshot }) }));
vi.mock('#hooks/use-cad-preview.js', () => ({
  CadPreviewProvider: (props: { readonly children: ReactNode }): ReactNode => {
    pipeline(props);
    return props.children;
  },
  useCadPreview: () => ({
    status: 'ready',
    parameterManifest: {
      defaults: { wall: 0.3 },
      schema: { properties: { wall: { title: 'Parete' } } },
      bindings: { '/wall': { unit: 'mm' } },
    },
  }),
}));
vi.mock('#components/cad-preview.js', () => ({ CadPreviewViewer: () => <div role='img' aria-label='Model' /> }));
const encode = (text: string) => uint8ArrayToBase64(new TextEncoder().encode(text));
const files = {
  'tau.json': uint8ArrayToBase64(
    serializeProjectManifest(
      projectToManifest({ name: 'Anello', description: '', tags: [], assets: { main: { entryPath: 'main.scad' } } }),
    ),
  ),
  'main.scad': encode('cube(10);'),
  'photo.png': 'AP+A',
  '.tau/parameters/main.scad.json': encode(
    JSON.stringify({
      activeGroup: 'default',
      groups: { default: { values: { wall: 0.4 }, units: { '/wall': 'mm' } } },
    }),
  ),
};
const revision: RevisionCard = {
  revisionId: 'old',
  n: 2,
  createdAt: 10,
  summary: '',
  actor: 'You',
  turnId: undefined,
  conflicted: false,
  trigger: 'save',
};

beforeEach(() => {
  snapshot.mockReset().mockResolvedValue(files);
  pipeline.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resetLanguageForTests();
});

describe('immutable revision preview', () => {
  it('should preserve binary inputs and refuse incomplete snapshots', () => {
    expect(decodeRevisionPreview(files).files['photo.png']?.content).toEqual(new Uint8Array([0, 255, 128]));
    expect(() => decodeRevisionPreview({})).toThrow('manifest');
    expect(() => decodeRevisionPreview({ 'tau.json': files['tau.json'] })).toThrow('model entry');
  });

  it.each(['it', 'en'] as const)(
    'should show saved measures read-only and return to latest in %s',
    async (language) => {
      setLanguage(language);
      const close = vi.fn();
      const user = userEvent.setup();
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <RevisionPreview revision={revision} onClose={close} />
        </QueryClientProvider>,
      );
      await waitFor(() => {
        expect(pipeline).toHaveBeenCalled();
      });
      expect(snapshot).toHaveBeenCalledExactlyOnceWith('old');
      expect(screen.getByRole('dialog')).toHaveAccessibleName(
        language === 'it' ? 'Stai guardando la Rev 2' : 'Viewing Rev 2',
      );
      expect(screen.getByRole('complementary')).toHaveAccessibleName(
        language === 'it' ? 'Misure in sola lettura' : 'Read-only measures',
      );
      expect(screen.getByText(language === 'it' ? '0,4 mm' : '0.4 mm')).toBeInTheDocument();
      expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(pipeline.mock.calls[0]?.[0]).toMatchObject({
        files: { 'main.scad': { content: new TextEncoder().encode('cube(10);') } },
      });
      await user.click(screen.getByRole('button', { name: language === 'it' ? 'Torna all’ultima' : 'Back to latest' }));
      expect(close).toHaveBeenCalledOnce();
    },
  );

  it('should explain how to recover when historical bytes cannot be read', async () => {
    setLanguage('it');
    snapshot.mockRejectedValue(new Error('secret-file.ts: unavailable'));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RevisionPreview revision={revision} onClose={() => undefined} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Chiudi l’anteprima e riprova');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('secret-file.ts');
  });
});
