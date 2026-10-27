// @vitest-environment jsdom

// oxlint-disable-next-line import/no-unassigned-import -- registers DOM matchers for this test module
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@taucad/ui/components/sidebar';
import type * as UseTheme from '#hooks/use-theme.js';
import { useTranslation } from '#i18n/translate.js';
import { setLanguage } from '#i18n/language.js';
import { SettingsDialog } from '#components/settings/settings-dialog.js';

const renderSecuritySettings = vi.hoisted(() => vi.fn(() => <div>Mounted security settings</div>));
const deferredBillingState = vi.hoisted(() => ({ showTarget: false }));
const { scrollTo } = HTMLElement.prototype;
const { scrollIntoView } = HTMLElement.prototype;

vi.mock('#components/auth/settings/account/account-settings.js', () => ({
  AccountSettings: () => <div>Mounted account settings</div>,
}));
vi.mock('#components/auth/settings/security/security-settings.js', () => ({
  SecuritySettings: renderSecuritySettings,
}));
vi.mock('#components/auth/api-key/api-keys.js', () => ({ ApiKeys: () => <div>Mounted API keys</div> }));
vi.mock('#components/settings/billing-settings.js', () => ({
  BillingSettings: () => (
    <div>
      Mounted billing
      {deferredBillingState.showTarget ? (
        <section id='settings-credit-balance' aria-label='Purchased credits' tabIndex={-1} />
      ) : null}
    </div>
  ),
}));
vi.mock('#components/settings/filesystem-settings.js', () => ({
  FileSystemSettings: () => <div>Mounted filesystem</div>,
}));
vi.mock('#components/settings/general-settings.js', () => ({
  GeneralSettings: () => (
    <div>
      Mounted general settings
      <section id='settings-theme' aria-label='Theme' tabIndex={-1}>
        Theme setting
      </section>
    </div>
  ),
}));
vi.mock('#components/settings/experimental-settings.js', () => ({
  ExperimentalSettings: () => <div>Mounted experimental</div>,
}));
vi.mock('#components/settings/model-settings.js', () => ({ ModelSettings: () => <div>Mounted models</div> }));
vi.mock('#components/settings/agent-settings.js', () => ({
  AgentSettings: () => (
    <div>
      Mounted agents
      <section id='settings-filesystem-context' aria-label='Filesystem' tabIndex={-1} />
    </div>
  ),
}));
vi.mock('#components/settings/remote-compute-settings.js', () => ({
  RemoteComputeSettings: () => <div>Mounted remote compute</div>,
}));
vi.mock('#components/settings/compute-reuse-settings.js', () => ({
  ComputeReuseSettings: () => <div>Mounted compute reuse</div>,
}));
vi.mock('#components/settings/settings-auth-gate.js', () => ({
  SettingsAuthGate: ({ children }: { readonly children: React.JSX.Element }): React.JSX.Element => children,
}));
vi.mock('@taucad/ui/components/keyboard', () => ({ useKeybinding: vi.fn() }));

function SettingsTestSurface({ url = '/home/project?settings=general' }: { readonly url?: string }): React.JSX.Element {
  return (
    <MemoryRouter initialEntries={[url]}>
      <SidebarProvider>
        <SettingsDialog />
      </SidebarProvider>
    </MemoryRouter>
  );
}

const setTheme = vi.hoisted(() => vi.fn());
const setPointer = vi.hoisted(() => vi.fn());
vi.mock('#hooks/use-cookie.js', () => ({ useCookie: () => [false, setPointer] }));
vi.mock('#hooks/use-theme.js', async (importOriginal) => {
  const actual = await importOriginal<typeof UseTheme>();
  return {
    ...actual,
    useTheme: () => {
      const { t } = useTranslation();
      return { themeWithSystem: actual.Theme.LIGHT, setTheme, options: actual.buildThemeOptions(t) };
    },
  };
});

describe('Sinopia SettingsDialog', () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  beforeEach(() => {
    setLanguage('en');
    vi.clearAllMocks();
  });
  afterAll(() => {
    HTMLElement.prototype.scrollTo = scrollTo;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });

  it.each(['billing', 'security', 'agents', 'filesystem', 'machines', 'repositories', 'compute', 'experimental'])(
    'should redirect a hidden %s deep link to appearance without mounting Tau content',
    (section) => {
      render(<SettingsTestSurface url={`/?settings=${section}`} />);
      expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
      expect(screen.queryByText(/Mounted/u)).not.toBeInTheDocument();
      expect(renderSecuritySettings).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Billing' })).not.toBeInTheDocument();
    },
  );

  it('should use the account theme and language owners and persist cursor preferences', async () => {
    const user = userEvent.setup();
    render(<SettingsTestSurface />);
    await user.click(screen.getByRole('radio', { name: 'Black' }));
    expect(setTheme).toHaveBeenCalledWith('black');
    await user.click(screen.getByRole('switch', { name: 'Cursors' }));
    expect(setPointer).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('radio', { name: 'Italiano' }));
    expect(screen.getByRole('heading', { name: 'Aspetto' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Cerca nelle impostazioni' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Segui il Mac' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Modello' }));
    expect(screen.getByText('mm')).toBeInTheDocument();
    expect(screen.getByText('Tutte le misure del modello sono in millimetri.')).toBeInTheDocument();
  });

  it('should search and focus a translated control without exposing technical sections', async () => {
    const user = userEvent.setup();
    render(<SettingsTestSurface />);
    const search = screen.getByRole('searchbox', { name: 'Search settings' });
    await user.type(search, 'units{Enter}');
    await waitFor(() => {
      expect(document.querySelector('#settings-units')).toHaveFocus();
    });
    await user.clear(search);
    await user.type(search, 'telemetry');
    expect(screen.getByText('No settings found')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
