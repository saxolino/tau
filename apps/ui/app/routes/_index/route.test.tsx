// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Home, { handle, meta } from '#routes/_index/route.js';

vi.mock('#routes/_index/sinopia-home.js', () => ({
  SinopiaHome: () => <div data-testid='sinopia-home' />,
}));

describe('Home route', () => {
  it('should render SinopiaCAD’s home', () => {
    render(<Home />);

    expect(screen.getByTestId('sinopia-home')).toBeInTheDocument();
  });

  it('should keep the app shell and lay out its own scrolling area beside the agent lane', () => {
    expect(handle.enablePageWrapper).toBe(true);
    expect(handle.enableOverflowY).toBeUndefined();
  });

  it('should provide an application title and description', () => {
    // MetaFunction args are unused by the homepage meta.
    const descriptors = meta({} as Parameters<typeof meta>[0]) as Array<Record<string, unknown>>;

    expect(descriptors.find((descriptor) => 'title' in descriptor)?.['title']).toBe('SinopiaCAD');
    expect(typeof descriptors.find((descriptor) => descriptor['name'] === 'description')?.['content']).toBe('string');
  });
});
