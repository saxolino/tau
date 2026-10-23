import { Code2, Cog, List, LogIn, LogOut, MessageCircle } from 'lucide-react';
import { useSession } from '@better-auth-ui/react';
import { authClient } from '#lib/auth-client.js';
import type { UIMatch } from 'react-router';
import { useCommandPaletteItems } from '#components/layout/command-palette.js';
import type { CommandPaletteItem } from '#components/layout/command-palette.js';
import { useAuthLinks } from '#hooks/use-auth-links.js';
import { useSettingsDialog } from '#hooks/use-settings-dialog.js';
import { useTranslation } from '#i18n/translate.js';

export function RootCommandPaletteItems({ match }: { readonly match: UIMatch }): undefined {
  const { t } = useTranslation();
  const { data: authData } = useSession(authClient);
  const { signIn, signOut } = useAuthLinks();
  const { open: openSettings } = useSettingsDialog();

  useCommandPaletteItems(
    match.id,
    (): CommandPaletteItem[] => [
      {
        id: 'new-project-from-prompt',
        label: t('shell.palette.newProjectFromChat'),
        group: t('shell.palette.groupProjects'),
        icon: <MessageCircle />,
        link: '/',
      },
      {
        id: 'new-project-from-code',
        label: t('shell.palette.newProjectFromCode'),
        group: t('shell.palette.groupProjects'),
        icon: <Code2 />,
        link: '/projects/new',
        shortcut: '⌃N',
      },
      {
        id: 'all-projects',
        label: t('shell.palette.allProjects'),
        group: t('shell.palette.groupProjects'),
        icon: <List />,
        link: '/projects',
      },
      {
        id: 'open-settings',
        label: t('shell.palette.settings'),
        group: t('shell.palette.groupSettings'),
        icon: <Cog />,
        action() {
          openSettings();
        },
        shortcut: '⌘,',
      },
      {
        id: 'sign-in',
        label: t('shell.palette.signIn'),
        group: t('shell.palette.groupSettings'),
        icon: <LogIn />,
        link: signIn,
        visible: !authData,
      },
      {
        id: 'sign-out',
        label: t('shell.palette.signOut'),
        group: t('shell.palette.groupSettings'),
        icon: <LogOut />,
        link: signOut,
        visible: Boolean(authData),
      },
    ],
    [authData, signIn, signOut, t],
  );

  return undefined;
}
