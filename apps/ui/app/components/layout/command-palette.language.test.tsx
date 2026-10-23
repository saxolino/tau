// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandPaletteProvider, Commands } from '#components/layout/command-palette.js';
import { SidebarProvider } from '#components/ui/sidebar.js';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

afterEach(() => {
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('Commands', () => {
  it.each([
    ['it', 'Cerca'],
    ['en', 'Search'],
  ] as const)('should name the search entry in %s', (language, search) => {
    setLanguage(language);
    render(
      <MemoryRouter>
        <KeyboardProvider>
          <TooltipProvider>
            <SidebarProvider>
              <CommandPaletteProvider>
                <Commands />
              </CommandPaletteProvider>
            </SidebarProvider>
          </TooltipProvider>
        </KeyboardProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: search })).toBeInTheDocument();
  });
});
