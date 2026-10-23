import { render, screen } from '@testing-library/react';
import type * as UseTheme from '#hooks/use-theme.js';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@taucad/ui/components/dropdown-menu';
import { getLanguage, languageStorageKey, resetLanguageForTests, setLanguage } from '#i18n/language.js';

const setTheme = vi.hoisted(() => vi.fn());
vi.mock('#hooks/use-theme.js', async (importOriginal) => {
  const actual = await importOriginal<typeof UseTheme>();
  const { useTranslation } = await import('#i18n/translate.js');
  return {
    ...actual,
    useTheme: () => {
      const { t } = useTranslation();
      return { themeWithSystem: actual.Theme.LIGHT, setTheme, options: actual.buildThemeOptions(t) };
    },
  };
});

const { AccountPreferences } = await import('#components/auth/sinopia/account-preferences.js');

const renderOpenMenu = async (): Promise<ReturnType<typeof userEvent.setup>> => {
  const user = userEvent.setup();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Account</DropdownMenuTrigger>
      <DropdownMenuContent>
        <AccountPreferences />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await user.click(screen.getByRole('button', { name: 'Account' }));
  return user;
};

afterEach(() => {
  setTheme.mockReset();
  globalThis.localStorage.clear();
  resetLanguageForTests();
});

describe('AccountPreferences', () => {
  it('should offer two themes and the system, the current one checked', async () => {
    setLanguage('it');
    await renderOpenMenu();

    const themes = screen.getByRole('group', { name: 'Tema' });
    expect(themes).toBeInTheDocument();
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Chiaro',
      'Nero',
      'Sistema',
      'Italiano',
      'English',
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'Chiaro' })).toHaveAttribute('aria-checked', 'true');
  });

  it('should switch to Nero at once', async () => {
    setLanguage('it');
    const user = await renderOpenMenu();

    await user.click(screen.getByRole('menuitemradio', { name: 'Nero' }));

    expect(setTheme).toHaveBeenCalledWith('black');
  });

  it('should switch the language at once, keep the menu open and remember it on this device', async () => {
    setLanguage('it');
    const user = await renderOpenMenu();

    await user.click(screen.getByRole('menuitemradio', { name: 'English' }));

    expect(getLanguage()).toBe('en');
    expect(globalThis.localStorage.getItem(languageStorageKey)).toBe('en');
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Black' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute('aria-checked', 'true');
  });
});
