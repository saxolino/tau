// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

const { useRootGatePlaceholder } = await import('#root-layout.js');

function GatePlaceholder(): React.ReactNode {
  return useRootGatePlaceholder() ?? <p>No route placeholder</p>;
}

const renderAt = (pathname: string): void => {
  render(
    <MemoryRouter initialEntries={[pathname]}>
      <GatePlaceholder />
    </MemoryRouter>,
  );
};

describe('useRootGatePlaceholder', () => {
  it('should give hidden Community no skeleton of its own, since it redirects home', () => {
    renderAt('/community');

    expect(screen.queryByRole('status', { name: 'Opening examples' })).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'SinopiaCAD' })).toBeInTheDocument();
  });

  it('should keep the workspace skeleton on a project URL', () => {
    renderAt('/w/home/bracket');

    expect(screen.getByRole('status', { name: 'Opening project' })).toBeInTheDocument();
  });

  it('should show Sinopia’s mark on other routes instead of a blank page', () => {
    renderAt('/projects');

    expect(screen.getByRole('status', { name: 'SinopiaCAD' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No route placeholder')).not.toBeInTheDocument();
  });
});
