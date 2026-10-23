// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AboutDialog } from '#components/nav/about-sinopiacad.js';

describe('AboutDialog', () => {
  it('should credit Tau under Apache-2.0 and link the licence and Sinopia’s legal pages', () => {
    render(<AboutDialog isOpen onOpenChange={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Informazioni' })).toBeInTheDocument();
    expect(screen.getByText('SinopiaCAD — basato su Tau (taucad/tau), licenza Apache-2.0.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Licenza Apache-2.0' })).toHaveAttribute(
      'href',
      'https://www.apache.org/licenses/LICENSE-2.0',
    );
    expect(screen.getByRole('link', { name: 'Codice sorgente di Tau' })).toHaveAttribute(
      'href',
      'https://github.com/taucad/tau',
    );
    expect(screen.getByRole('link', { name: 'Informativa privacy' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/privacy-policy',
    );
    expect(screen.getByRole('link', { name: 'Condizioni d’uso' })).toHaveAttribute(
      'href',
      'https://sinopialab.com/beta/condizioni',
    );
  });

  it('should close from its Chiudi action', () => {
    const onOpenChange = vi.fn();
    render(<AboutDialog isOpen onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
