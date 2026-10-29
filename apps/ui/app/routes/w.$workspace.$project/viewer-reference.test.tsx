// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { schedaParteDiProva, schedaRiconoscimentoDiProva } from '@taucad/smlib/riconoscimento';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { progettoRiconosciuto } from '#services/riconoscimento-progetto.js';

const radice = '/projects/proj_1';
/** Il disco del progetto: sopravvive a un rimontaggio, come OPFS a un ricaricamento della pagina. */
const disco = new Map<string, Uint8Array<ArrayBuffer>>();
/** File elencati ma illeggibili. */
const rotti = new Set<string>();
type Sessione = { status: string; user?: { id: string } };
const stato = vi.hoisted(() => {
  const sessione: Sessione = { status: 'disabled' };
  return {
    sessione,
    nomeProgetto: vi.fn(async (): Promise<string | undefined> => undefined),
    /** Un visore disegnato fuori da un file manager (un'anteprima). */
    senzaDisco: false,
    /** Il progetto aperto nel visore. */
    progetto: 'proj_1',
    /** Letture di immagini trattenute, per cartella di progetto: simulano un disco lento. */
    porte: new Map<string, Promise<void>>(),
    /** Ogni file chiesto al disco, in ordine. */
    lette: [] as string[],
  };
});

vi.mock('#hooks/use-project.js', () => ({ useProject: () => ({ projectId: stato.progetto }) }));
vi.mock('#hooks/use-file-manager.js', () => {
  // One client for the whole session, as the file manager gives it.
  const recordFiles = {
    exists: async (path: string) =>
      disco.has(path) || [...disco.keys()].some((chiave) => chiave.startsWith(`${path}/`)),
    readdir: async (path: string) => [
      ...new Set(
        [...disco.keys()]
          .filter((chiave) => chiave.startsWith(`${path}/`))
          .map((chiave) => chiave.slice(path.length + 1).split('/')[0]!),
      ),
    ],
    readFile: async (path: string) => {
      stato.lette.push(path);
      for (const [cartella, porta] of stato.porte) {
        if (path.startsWith(`${cartella}/`) && /\.(?:png|jpe?g|webp)$/.test(path)) {
          await porta;
        }
      }
      const bytes = disco.get(path);
      if (!bytes || rotti.has(path)) {
        throw new Error(`ENOENT: ${path}`);
      }
      return bytes;
    },
  };
  return { useOptionalFileManager: () => (stato.senzaDisco ? undefined : { recordFiles }) };
});
vi.mock('#hooks/use-sinopia-session.js', () => ({ useSinopiaSession: () => stato.sessione }));
vi.mock('#services/sinopia-references.js', () => ({ readSinopiaProjectName: stato.nomeProgetto }));

const { useRiferimentoVisore, ViewerReferencePanel, ViewerReferenceToggle } =
  await import('#routes/w.$workspace.$project/viewer-reference.js');

/** Come il visore li compone: il pulsante nella barra solo con un riferimento, il pannello accanto al riquadro. */
function Visore({ isEnabled = true }: { readonly isEnabled?: boolean }): React.JSX.Element {
  const riferimento = useRiferimentoVisore(isEnabled);
  return (
    <>
      <div role='group' aria-label='Comandi della vista'>
        <button type='button'>Adatta</button>
        {riferimento.riferimenti.length > 0 ? <ViewerReferenceToggle riferimento={riferimento} /> : null}
      </div>
      <ViewerReferencePanel riferimento={riferimento} isBelowGizmo />
    </>
  );
}

const monta = (properties: { readonly isEnabled?: boolean } = {}): ReturnType<typeof render> =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TooltipProvider>
        <Visore {...properties} />
      </TooltipProvider>
    </QueryClientProvider>,
  );

/** I file di un progetto creato da «/cad/nuovo», scritti come li scrive il riconoscimento. */
const progettoDaFoto = (cartella = radice): void => {
  const progetto = progettoRiconosciuto({
    scheda: schedaRiconoscimentoDiProva,
    schedaParte: schedaParteDiProva,
    immagine: { bytes: new Uint8Array([1, 2, 3]), tipo: 'image/png' },
    maschera: new Uint8Array([4]),
    lingua: 'it',
  })!;
  for (const [percorso, file] of Object.entries(progetto.files)) {
    disco.set(`${cartella}/${percorso}`, file.content);
  }
};

const pulsante = async (): Promise<HTMLElement> => screen.findByRole('button', { name: 'Riferimento' });
const pannello = (): HTMLElement | undefined => screen.queryByRole('dialog', { name: 'Riferimento' }) ?? undefined;

beforeEach(() => {
  setLanguage('it');
  disco.clear();
  rotti.clear();
  stato.senzaDisco = false;
  stato.progetto = 'proj_1';
  stato.porte.clear();
  stato.lette.length = 0;
  stato.sessione = { status: 'disabled' };
  stato.nomeProgetto.mockReset();
  stato.nomeProgetto.mockResolvedValue(undefined);
  let numero = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => `blob:riferimento-${++numero}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  // Unmount before the language goes back: a mounted panel would re-render outside act.
  cleanup();
  vi.unstubAllGlobals();
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('the reference in the viewer', () => {
  it('should offer no button when the model was not built from an image', async () => {
    disco.set(`${radice}/main.ts`, new TextEncoder().encode('export default {}'));
    monta();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Adatta' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Riferimento' })).not.toBeInTheDocument();
    expect(pannello()).toBeUndefined();
  });

  it('should offer no button in a read-only shared view, even with references', async () => {
    progettoDaFoto();
    monta({ isEnabled: false });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Riferimento' })).not.toBeInTheDocument();
  });

  it('should offer no button in a viewer drawn outside a file manager', async () => {
    progettoDaFoto();
    stato.senzaDisco = true;
    monta();

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Riferimento' })).not.toBeInTheDocument();
  });

  it('should show the photo a recognised piece came from, with its part, and hide it on a second click', async () => {
    const user = userEvent.setup();
    progettoDaFoto();
    monta();

    const toggle = await pulsante();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    // The button wears the picture itself, once read.
    await waitFor(() => {
      expect(toggle.querySelector('img')).toHaveAttribute('src', 'blob:riferimento-1');
    });

    await user.click(toggle);

    const aperto = pannello();
    expect(aperto).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('img', { name: 'Da foto · Fibbia del cinturino' })).toBeInTheDocument();
    expect(screen.getByText('Da foto · Fibbia del cinturino')).toBeInTheDocument();
    // The part stands out: its mask veils the rest of the photo.
    await waitFor(() => {
      expect(aperto?.querySelector('[data-slot="viewer-reference-mask"]')).not.toBeNull();
    });

    await user.click(toggle);

    expect(pannello()).toBeUndefined();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('should close with Esc and give the keyboard back to the button', async () => {
    const user = userEvent.setup();
    progettoDaFoto();
    monta();
    const toggle = await pulsante();

    await user.click(toggle);
    expect(pannello()).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(pannello()).toBeUndefined();
    expect(toggle).toHaveFocus();
  });

  it('should close with its X and grow with Ingrandisci', async () => {
    const user = userEvent.setup();
    progettoDaFoto();
    monta();
    await user.click(await pulsante());

    await user.click(screen.getByRole('button', { name: 'Ingrandisci' }));
    expect(pannello()).toHaveAttribute('data-size', 'large');
    expect(screen.getByRole('button', { name: 'Riduci' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Chiudi il riferimento' }));
    expect(pannello()).toBeUndefined();
  });

  it('should find the reference again after a reload, from the project files alone', async () => {
    progettoDaFoto();
    const prima = monta();
    await pulsante();

    // A reload: nothing kept in memory, only the project on disk.
    prima.unmount();
    monta();

    const user = userEvent.setup();
    await user.click(await pulsante());
    expect(await screen.findByRole('img', { name: 'Da foto · Fibbia del cinturino' })).toBeInTheDocument();
  });

  it('should page through several references with the arrows and the arrow keys', async () => {
    const user = userEvent.setup();
    disco.set(`${radice}/riferimenti/sinopia-3f2a9c1e.jpg`, new Uint8Array([1]));
    disco.set(`${radice}/riferimenti/schizzo.png`, new Uint8Array([2]));
    disco.set(
      `${radice}/riferimenti/misure.json`,
      new TextEncoder().encode(JSON.stringify([{ filename: 'sinopia-3f2a9c1e.jpg', name: 'Sandalo Fiore' }])),
    );
    monta();
    await user.click(await pulsante());

    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('Da Sinopia · Sandalo Fiore')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Riferimento successivo' }));
    expect(screen.getByText('Immagine caricata')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('Da Sinopia · Sandalo Fiore')).toBeInTheDocument();
  });

  it('should name the Sinopia project an image comes from, for its own account only', async () => {
    const user = userEvent.setup();
    const link = {
      modelId: '4c1f1b8e-2f8a-4d6b-9a51-0d3f3c2b1a10',
      projectId: '0f9d7a8e-5b1c-4c2d-9e3f-1a2b3c4d5e6f',
      userId: '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d',
      baseRevisionId: null,
    };
    disco.set(`${radice}/riferimenti/sinopia-3f2a9c1e.jpg`, new Uint8Array([1]));
    disco.set(`${radice}/.tau/sinopia.json`, new TextEncoder().encode(JSON.stringify(link)));
    stato.sessione = { status: 'signed-in', user: { id: link.userId } };
    stato.nomeProgetto.mockResolvedValue('Collezione FW26');
    monta();

    // Nothing is read before the panel opens.
    await pulsante();
    expect(stato.nomeProgetto).not.toHaveBeenCalled();
    await user.click(await pulsante());

    expect(await screen.findByText('Da Sinopia · Collezione FW26')).toBeInTheDocument();
    expect(stato.nomeProgetto).toHaveBeenCalledWith(link.projectId, expect.any(AbortSignal));
  });

  it("should not show the previous project's picture when another project opens while it is still being read", async () => {
    // Two projects made from a photo carry the same file names: only the project tells their pictures apart.
    progettoDaFoto();
    progettoDaFoto('/projects/proj_2');
    let liberaPrimo = (): void => undefined;
    let liberaSecondo = (): void => undefined;
    stato.porte.set('/projects/proj_1', new Promise<void>((fatto) => (liberaPrimo = fatto)));
    stato.porte.set('/projects/proj_2', new Promise<void>((fatto) => (liberaSecondo = fatto)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // A new element at each render: the same element object would let React skip the new project.
    const albero = (): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <Visore />
        </TooltipProvider>
      </QueryClientProvider>
    );
    const vista = render(albero());
    await pulsante();

    stato.progetto = 'proj_2';
    vista.rerender(albero());
    // The second project's picture is being read before the first one's arrives.
    await waitFor(() => {
      expect(stato.lette.some((letto) => letto.startsWith('/projects/proj_2/') && letto.endsWith('.png'))).toBe(true);
    });
    // The first project's picture arrives late, while the second one is still being read.
    await act(async () => {
      liberaPrimo();
      await Promise.resolve();
    });
    await act(async () => {
      liberaSecondo();
      await Promise.resolve();
    });

    const toggle = await pulsante();
    await waitFor(() => {
      expect(toggle.querySelector('img')).toHaveAttribute('src', 'blob:riferimento-2');
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:riferimento-1');
  });

  it('should say so when the picture cannot be read', async () => {
    const user = userEvent.setup();
    disco.set(`${radice}/riferimenti/foto.png`, new Uint8Array([1]));
    rotti.add(`${radice}/riferimenti/foto.png`);
    const errore = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    monta();

    await user.click(await pulsante());

    expect(await screen.findByRole('alert')).toHaveTextContent('Non riesco a leggere questa immagine.');
    expect(errore).toHaveBeenCalledWith('Failed to read a reference image:', expect.any(Error), {
      percorso: 'riferimenti/foto.png',
    });
    errore.mockRestore();
  });
});
