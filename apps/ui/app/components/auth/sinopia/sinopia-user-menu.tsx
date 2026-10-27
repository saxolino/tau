import { ChevronsUpDown, Globe, LogOut, Settings } from 'lucide-react';
import { useState } from 'react';
import { AboutDialog, AboutMenuItem } from '#components/nav/about-sinopiacad.js';
import { useSettingsDialog } from '#hooks/use-settings-dialog.js';
import type { ReactNode } from 'react';
import { Avatar, AvatarFallback } from '@taucad/ui/components/avatar';
import { Button } from '@taucad/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { cn } from '@taucad/ui/utils/cn';
import { sinopiaSession } from '#lib/sinopia-session.js';
import type { SinopiaUser } from '#lib/sinopia-session.js';
import { AccountPreferences } from '#components/auth/sinopia/account-preferences.js';
import { useTranslation } from '#i18n/translate.js';

function SinopiaAvatar({ user, className }: { readonly user: SinopiaUser; readonly className?: string }): ReactNode {
  return (
    <Avatar aria-hidden className={cn('size-8 rounded-full bg-muted text-sm text-foreground', className)}>
      <AvatarFallback>{(user.email ?? 'S').slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/**
 * SinopiaCAD's account menu: the signed-in Sinopia account, the theme and the language, the app's own entries, then
 * «Esci», which signs out of Sinopia on this browser (online, Sinopia shares the session, so it signs out there too).
 * It replaces Tau's account chrome inside `UserButton` while a Sinopia session exists.
 *
 * @param properties - The account and the trigger's look and placement.
 * @returns The account menu.
 */
export function SinopiaUserMenu({
  user,
  className,
  align,
  side,
  sideOffset,
  size,
  variant,
}: {
  readonly user: SinopiaUser;
  readonly className?: string;
  readonly align?: 'center' | 'end' | 'start' | undefined;
  readonly side?: 'top' | 'right' | 'bottom' | 'left';
  readonly sideOffset?: number;
  readonly size: 'default' | 'icon' | 'sm';
  readonly variant: 'default' | 'destructive' | 'ghost' | 'link' | 'outline' | 'secondary';
}): React.JSX.Element {
  const { t } = useTranslation();
  const { open: openSettings } = useSettingsDialog();
  const [isAboutOpen, setAboutOpen] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  // What the menu names the account by when the session carries no email.
  const accountLabel = t('account.sinopiaAccount');
  const name = user.email ?? accountLabel;
  const isCompact = size === 'sm';

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {size === 'icon' ? (
            <button
              type='button'
              aria-label={name}
              className={cn('rounded-full outline-none focus-visible:focus-outline', className)}
            >
              <SinopiaAvatar user={user} />
            </button>
          ) : (
            <Button
              variant={variant}
              size={isCompact ? 'sm' : 'lg'}
              className={cn('font-normal', size === 'default' && 'h-auto py-2.5', className)}
            >
              <SinopiaAvatar user={user} className={cn(isCompact && 'size-4 text-[10px]')} />
              {isCompact ? (
                <span className='min-w-0 flex-1 truncate text-left text-sm leading-tight'>{name}</span>
              ) : (
                /* The card: the address as the name (Sinopia's session carries no name), the account under it. */
                <span className='grid min-w-0 flex-1 text-left leading-tight'>
                  <span className='truncate text-sm font-medium text-foreground'>{name}</span>
                  <span className='truncate text-xs text-muted-foreground'>{accountLabel}</span>
                </span>
              )}
              {isCompact ? null : <ChevronsUpDown className='ml-auto size-3.5 text-muted-foreground' />}
            </Button>
          )}
        </DropdownMenuTrigger>

        <DropdownMenuContent
          className='w-64 max-w-[calc(100svw-2rem)]'
          sideOffset={sideOffset}
          side={side}
          align={align}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
        >
          <DropdownMenuLabel className='text-sm font-normal'>
            <div className='flex items-center gap-2'>
              <SinopiaAvatar user={user} />
              <div className='grid min-w-0 flex-1 text-left leading-tight'>
                <span className='truncate font-medium text-foreground'>{name}</span>
                <span className='truncate text-xs text-muted-foreground'>{accountLabel}</span>
              </div>
            </div>
          </DropdownMenuLabel>

          {signOutFailed ? (
            <p role='alert' className='px-2 text-sm text-destructive'>
              {t('account.signOutFailed')}
            </p>
          ) : null}

          <DropdownMenuSeparator />

          {/* SinopiaCAD: theme and language sit in the account menu, never in the top bar (UI-UX-SinopiaCAD §1.1). */}
          <AccountPreferences />

          <DropdownMenuSeparator />

          <DropdownMenuItem asChild>
            <a href='https://sinopialab.com' target='_blank' rel='noopener noreferrer'>
              <Globe />
              {t('account.website')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              openSettings('general');
            }}
          >
            <Settings />
            {t('account.settings.title')}
          </DropdownMenuItem>
          <AboutMenuItem
            onSelect={() => {
              setAboutOpen(true);
            }}
          />

          <DropdownMenuSeparator />

          <DropdownMenuItem
            onSelect={() => {
              // async-iife: bootstrap -- signing out announces itself; the gate then shows the sign-in screen.
              void (async (): Promise<void> => {
                try {
                  await sinopiaSession().signOut();
                } catch (error) {
                  console.error('[sinopia] sign-out failed', error);
                  setSignOutFailed(true);
                }
              })();
            }}
          >
            <LogOut className='text-muted-foreground' />
            {t('account.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AboutDialog isOpen={isAboutOpen} onOpenChange={setAboutOpen} />
    </>
  );
}
