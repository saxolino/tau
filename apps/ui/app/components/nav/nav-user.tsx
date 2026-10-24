import { useState } from 'react';
import { CircleHelp, Files, FileText, Globe, Scale, Settings, Shield, WifiOff } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { ClientOnly } from '@taucad/ui/components/client-only';
import { useSettingsDialog } from '#hooks/use-settings-dialog.js';
import { UserButton } from '#components/auth/user/user-button.js';
import { useNetworkConnectivity } from '#hooks/use-network-connectivity.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { metaConfig } from '#constants/meta.constants.js';
import { legalUrl } from '#lib/legal-url.js';
import { isDesktopTarget } from '#lib/build-target.js';
import { CookiePreferencesDialog, CookiePreferencesMenuItem } from '#components/cookie-preferences.js';
import { AboutDialog, AboutMenuItem } from '#components/nav/about-sinopiacad.js';
import { NavBillingItem, NavCreditsMeter } from '#cloud/nav-billing.js';
import { useTranslation } from '#i18n/translate.js';

/** Sinopia's own site, the Help menu's one link out besides the legal pages. */
const sinopiaWebsiteUrl = 'https://sinopialab.com';

/**
 * Nav user button: delegates avatar, sign-in/up/out chrome to the registry
 * `<UserButton>`, and extends the dropdown with Tau-specific items (Billing,
 * Settings dialog) via the `links` prop.
 *
 * `shouldHideSettings` suppresses the built-in navigation link so we can open the
 * dialog instead (Tau's settings live in a modal, not a dedicated route).
 */
export function NavUser(): React.JSX.Element {
  const { t } = useTranslation();
  const isOnline = useNetworkConnectivity();
  const { open: openSettings } = useSettingsDialog();
  const [isCookiePreferencesOpen, setIsCookiePreferencesOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const helpItems = [
    /* SinopiaCAD: one external link to Sinopia's site. It never sets the entry preference that chooses the start
     * page at `/`, so the app keeps opening on the workspace. */
    ...(isDesktopTarget()
      ? []
      : [
          <DropdownMenuItem key='website' asChild>
            <a href={sinopiaWebsiteUrl} target='_blank' rel='noopener noreferrer'>
              <Globe />
              {t('shell.user.website')}
            </a>
          </DropdownMenuItem>,
        ]),
    <DropdownMenuItem key='privacy' asChild>
      <a href={legalUrl('privacy')} target='_blank' rel='noopener noreferrer'>
        <Shield />
        {t('shell.user.privacy')}
      </a>
    </DropdownMenuItem>,
    <DropdownMenuItem key='terms' asChild>
      <a href={legalUrl('terms')} target='_blank' rel='noopener noreferrer'>
        <FileText />
        {t('shell.user.terms')}
      </a>
    </DropdownMenuItem>,
    <AboutMenuItem
      key='about'
      onSelect={() => {
        setIsAboutOpen(true);
      }}
    />,
    <DropdownMenuItem key='open-source' asChild>
      <a href={legalUrl('open-source')} target='_blank' rel='noopener noreferrer'>
        <Scale />
        {t('shell.user.openSource')}
      </a>
    </DropdownMenuItem>,
    <CookiePreferencesMenuItem
      key='cookies'
      onSelect={() => {
        setIsCookiePreferencesOpen(true);
      }}
    />,
  ];

  return (
    <ClientOnly>
      <div className='flex w-full items-center gap-1'>
        <div className='relative min-w-0 flex-1'>
          <UserButton
            variant='ghost'
            size='sm'
            className='h-7 w-full justify-start px-2.5 select-none'
            align='start'
            side='top'
            sideOffset={8}
            shouldHideSettings
            header={<NavCreditsMeter />}
            links={[
              ...(isOnline
                ? []
                : [
                    <DropdownMenuItem key='offline' disabled>
                      <WifiOff />
                      {t('shell.user.offlineItem')}
                    </DropdownMenuItem>,
                  ]),
              <NavBillingItem key='billing' />,
              { label: t('shell.user.files'), href: '/files', icon: <Files /> },
              <DropdownMenuItem
                key='settings'
                onSelect={() => {
                  openSettings('general');
                }}
              >
                <Settings />
                {t('shell.user.settings')}
              </DropdownMenuItem>,
            ]}
          />
          {isOnline ? null : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role='status'
                  aria-label={t('shell.user.offline')}
                  className='absolute top-1 left-5 size-1.5 rounded-full border border-sidebar bg-feature'
                />
              </TooltipTrigger>
              <TooltipContent side='top'>{t('shell.user.offlineTooltip')}</TooltipContent>
            </Tooltip>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label={t('shell.user.help')}
              variant='ghost'
              size='icon-sm'
              className='size-7 text-muted-foreground data-[state=open]:bg-accent/50'
            >
              <CircleHelp />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side='top' align='end' sideOffset={8} className='min-w-52'>
            {helpItems}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className='font-normal text-muted-foreground'>
              {t('shell.user.version', { version: metaConfig.version })}
            </DropdownMenuLabel>
          </DropdownMenuContent>
        </DropdownMenu>
        <CookiePreferencesDialog isOpen={isCookiePreferencesOpen} onOpenChange={setIsCookiePreferencesOpen} />
        <AboutDialog isOpen={isAboutOpen} onOpenChange={setIsAboutOpen} />
      </div>
    </ClientOnly>
  );
}
