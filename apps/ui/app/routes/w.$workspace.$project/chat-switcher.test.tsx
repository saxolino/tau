// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { resetLanguageForTests, setLanguage } from '#i18n/language.js';

const chats = [
  { id: 'chat_old', name: 'Initial design', recencyAt: 1, createdAt: 1 },
  { id: 'chat_active', name: 'Marquise più lunga', recencyAt: 3, createdAt: 2 },
];

vi.mock('#hooks/use-chat.js', () => ({
  useChatContext: () => ({ activeChatId: 'chat_active' }),
}));
vi.mock('#hooks/use-project.js', () => ({
  useProject: () => ({ projectId: 'proj_one' }),
}));
vi.mock('#hooks/use-chat-records.js', () => ({
  useChatRecords: () => ({ chats, isLoading: false, error: undefined }),
}));
vi.mock('#hooks/use-project-slug-route.js', () => ({
  useProjectSlugs: () => ({ status: 'resolved', value: { workspaceSlug: 'home', projectSlug: 'collana' } }),
}));

const { ChatSwitcher } = await import('#routes/w.$workspace.$project/chat-switcher.js');

function Location(): React.JSX.Element {
  return <output aria-label='Current URL'>{useLocation().search}</output>;
}

function renderSwitcher(): void {
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <MemoryRouter initialEntries={['/w/home/collana?chat=chat_active&workbench=share']}>
      <TooltipProvider>{children}</TooltipProvider>
    </MemoryRouter>
  );
  render(
    <>
      <ChatSwitcher />
      <Location />
    </>,
    { wrapper },
  );
}

describe('ChatSwitcher', () => {
  afterEach(() => {
    globalThis.localStorage.clear();
    resetLanguageForTests();
  });

  it('should list the project’s conversations, Tau’s placeholder names as «Agente», then the archived ones', async () => {
    setLanguage('it');
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Conversazioni precedenti' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Marquise più lunga',
      'Agente',
      'Conversazioni archiviate',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Agente' })).toHaveAttribute('href', '/w/home/collana?chat=chat_old');
  });

  it('opens the project archive while preserving the current chat and other query state', async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole('button', { name: 'Earlier conversations' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archived conversations' }));

    expect(screen.getByRole('status', { name: 'Current URL' })).toHaveTextContent(
      'chat=chat_active&workbench=share&archivedChats=1',
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
