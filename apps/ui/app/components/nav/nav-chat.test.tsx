import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { NavChat } from '#components/nav/nav-chat.js';
import { SidebarProvider } from '#components/ui/sidebar.js';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

function NavigationProbe(): React.JSX.Element {
  const location = useLocation() as { state: unknown };
  return (
    <>
      <output data-testid='navigation-type'>{useNavigationType()}</output>
      <output data-testid='focus-request'>
        {String((location.state as { focusChatComposer?: unknown } | undefined)?.focusChatComposer === true)}
      </output>
    </>
  );
}

function renderNavChat(): void {
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <KeyboardProvider>
        <TooltipProvider>
          <SidebarProvider>
            <NavChat />
            <NavigationProbe />
            <Routes>
              <Route path='/' element={<p>Home Composer</p>} />
              <Route path='*' element={null} />
            </Routes>
          </SidebarProvider>
        </TooltipProvider>
      </KeyboardProvider>
    </MemoryRouter>,
  );
}

describe('NavChat', () => {
  afterEach(() => {
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });

  it.each([
    ['it', 'Nuovo progetto'],
    ['en', 'New project'],
  ] as const)('should name the link in %s', (language, name) => {
    setLanguage(language);
    renderNavChat();

    expect(screen.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', '/');
  });

  it('should link New project to the home composer, not the project creation page', () => {
    renderNavChat();

    expect(screen.getByRole('link', { name: /New project/ })).toHaveAttribute('href', '/');
  });

  it('should ask the home composer for focus when clicked', async () => {
    renderNavChat();

    await userEvent.click(screen.getByRole('link', { name: /New project/ }));

    expect(await screen.findByText('Home Composer')).toBeInTheDocument();
    expect(screen.getByTestId('focus-request')).toHaveTextContent('true');
  });

  it('should open the home composer from its shortcut', async () => {
    renderNavChat();

    await userEvent.keyboard('{Control>}n{/Control}');

    expect(await screen.findByText('Home Composer')).toBeInTheDocument();
    expect(screen.getByTestId('focus-request')).toHaveTextContent('true');
  });

  it('should replace the history entry when the shortcut is pressed on the home composer', async () => {
    renderNavChat();

    await userEvent.keyboard('{Control>}n{/Control}');
    await userEvent.keyboard('{Control>}n{/Control}');

    expect(await screen.findByText('Home Composer')).toBeInTheDocument();
    expect(screen.getByTestId('navigation-type')).toHaveTextContent('REPLACE');
  });
});
