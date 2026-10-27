import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leggiLogoSvg } from '@taucad/smlib/famiglie';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';
import { dimensioneMassimaLogo, LogoSectionView, leggiFileLogo } from '#routes/w.$workspace.$project/inspector-logo.js';

const svgUtente =
  '<svg viewBox="0 0 40 30"><script>alert("x")</script><path d="M0 0H40V30H0Z M10 10V20H30V10Z" onclick="evil()"/></svg>';
const file = (contenuto: string, nome = 'logo.svg', size = contenuto.length) => ({
  name: nome,
  size,
  type: 'image/svg+xml',
  text: async () => contenuto,
});
const valori = { modo: 'rilievo', larghezza: 10, profondita: 0.3, x: 0, y: 0 } as const;

beforeEach(() => {
  setLanguage('it');
});
afterEach(() => {
  resetLanguageForTests();
});

describe('leggiFileLogo', () => {
  it('should turn a file into outlines and a clean rewrite, never the user’s text', async () => {
    const esito = await leggiFileLogo(file(svgUtente));
    expect(esito.ok).toBe(true);
    if (esito.ok) {
      expect(esito.svg).not.toMatch(/script|onclick|alert/u);
      expect(esito.logo.contorni).toHaveLength(2);
    }
  });

  it('should refuse a file that is too big, not an SVG, or not a valid logo', async () => {
    expect(await leggiFileLogo(file(svgUtente, 'logo.svg', dimensioneMassimaLogo + 1))).toEqual({
      ok: false,
      errore: 'tooBig',
    });
    expect(await leggiFileLogo({ ...file('PNG', 'logo.png'), type: 'image/png' })).toMatchObject({
      ok: false,
      errore: 'notSvg',
    });
    expect(await leggiFileLogo({ ...file('x'), type: 'image/svg+xml', text: async () => 'ciao' })).toEqual({
      ok: false,
      errore: 'SVG_NON_VALIDO',
    });
    expect(await leggiFileLogo(file('<svg><path d="M0 0 L40 0 L40 30"/></svg>'))).toEqual({
      ok: false,
      errore: 'SVG_APERTO',
    });
    expect(await leggiFileLogo(file('<svg><path d="M0 0 L40 30 L40 0 L0 30 Z"/></svg>'))).toEqual({
      ok: false,
      errore: 'SVG_AUTOINTERSECANTE',
    });
  });
});

describe('LogoSectionView', () => {
  const logo = leggiLogoSvg(svgUtente);
  const base = {
    isLocked: false,
    valori,
    esiti: [],
    errore: undefined,
    onFile: vi.fn(),
    onRimuovi: vi.fn(),
    onValori: vi.fn(),
  };

  it('should offer the upload and hand the picked file over', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<LogoSectionView {...base} logo={undefined} onFile={onFile} />);
    expect(screen.queryByRole('button', { name: 'Rimuovi' })).not.toBeInTheDocument();
    const scelto = new File([svgUtente], 'logo.svg', { type: 'image/svg+xml' });
    await user.upload(screen.getByLabelText('Carica SVG', { selector: 'input' }), scelto);
    expect(onFile).toHaveBeenCalledExactlyOnceWith(scelto);
  });

  it('should draw the preview from the outlines only: no raw SVG, script or image in the DOM', () => {
    const { container } = render(<LogoSectionView {...base} logo={logo} isLocked />);
    const anteprima = screen.getByRole('img', { name: 'Anteprima del logo' });
    expect(anteprima.querySelector('path')?.getAttribute('d')).toMatch(/^M[\d. -]+Z M/u);
    expect(container.querySelector('script, image, img, foreignObject')).toBeNull();
    expect(container.innerHTML).not.toMatch(/alert|onclick|evil/u);
    expect(screen.getByLabelText('Logo fissato da te')).toBeInTheDocument();
  });

  it('should remove the logo, change a value and show the checks and a refusal near the field', async () => {
    const user = userEvent.setup();
    const onRimuovi = vi.fn();
    const onValori = vi.fn();
    render(
      <LogoSectionView
        {...base}
        logo={logo}
        onRimuovi={onRimuovi}
        onValori={onValori}
        errore='Un contorno è aperto: chiudilo (Z) e riprova.'
        esiti={[{ livello: 'avviso', codice: 'TRATTO_MIN_LOGO', messaggio: 'Tratto del logo 0,3 mm: al limite.' }]}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Un contorno è aperto');
    expect(screen.getByText('Tratto del logo 0,3 mm: al limite.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rimuovi' }));
    expect(onRimuovi).toHaveBeenCalledOnce();
    const larghezza = screen.getByLabelText('Larghezza (mm)');
    await user.clear(larghezza);
    await user.type(larghezza, '14{Enter}');
    await waitFor(() => {
      expect(onValori).toHaveBeenCalledWith({ larghezza: 14 });
    });
  });
});
