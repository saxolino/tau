// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import DesktopHome, { handle, meta } from '#routes/_index/home-surface.desktop.js';

vi.mock('#routes/_index/sinopia-home.js', () => ({ SinopiaHome: () => <div>sinopia home</div> }));

describe('desktop home surface', () => {
  it('should render the same home as the web, inside the app shell', () => {
    render(<DesktopHome />, { wrapper: MemoryRouter });

    expect(screen.getByText('sinopia home')).toBeInTheDocument();
    expect(handle.enablePageWrapper).toBe(true);
  });

  it('should leave out Tau’s examples gallery while Community is hidden', () => {
    render(<DesktopHome />, { wrapper: MemoryRouter });

    expect(screen.queryByRole('heading', { name: 'Built with Tau' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View all' })).not.toBeInTheDocument();
  });

  it('should be titled SinopiaCAD', () => {
    const descriptors = meta({} as Parameters<typeof meta>[0]) as Array<Record<string, unknown>>;

    expect(descriptors.find((descriptor) => 'title' in descriptor)?.['title']).toBe('SinopiaCAD');
  });
});
