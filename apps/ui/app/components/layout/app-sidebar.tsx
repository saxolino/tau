import * as React from 'react';
import { Link, useMatch } from 'react-router';
import { ArrowUpRight, FolderOpen, Home } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { HomeRecentNavigation } from '#components/nav/home-recent-navigation.js';
import { SidebarSection } from '#components/nav/sidebar-section.js';
import { SinopiaToolsNavigation } from '#components/nav/sinopia-tools-navigation.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from '#components/ui/sidebar.js';
import { SinopiaCadWordmark, SinopiaMark } from '#components/icons/sinopiacad-wordmark.js';
import { Commands } from '#components/layout/command-palette.js';
import { DesktopUpdate } from '#components/nav/desktop-update.js';
import { NavUser } from '#components/nav/nav-user.js';
import { baseUrl } from '#lib/base-path.js';
import { isDesktopTarget } from '#lib/build-target.js';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';

/**
 * Where «Torna a Sinopia» goes: under `/cad` of sinopialab.com the CAD shares Sinopia's origin, so a path is enough (a
 * full navigation, same session); on its own origins (development, previews) the address is sinopialab.com's.
 *
 * @returns The dashboard's address.
 */
export const sinopiaDashboardUrl = (): string =>
  baseUrl() === '/cad/' ? '/dashboard' : 'https://sinopialab.com/dashboard';

/**
 * A row's class on top of the sidebar button: the current page is named by its weight and by its glyph in Sinopia's
 * red, as the family's sidebar does; nothing else in the bar is red.
 */
const rowClass = 'data-[active=true]:font-medium data-[active=true]:[&>svg]:text-primary';

/** One destination of the first group: its glyph and name, current on its own route and the routes under it. */
function PrimaryRow({
  to,
  icon: Icon,
  label,
  end = false,
}: Readonly<{ to: string; icon: LucideIcon; label: string; end?: boolean }>): React.JSX.Element {
  const isCurrent = useMatch({ path: to, end }) !== null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isCurrent} className={rowClass}>
        <Link to={to} aria-current={isCurrent ? 'page' : undefined}>
          <Icon aria-hidden />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/**
 * SinopiaCAD's sidebar, in the grammar of Sinopia's own (the family's approved bar), on the CAD's warm light tokens:
 * search, then «Inizio» and «Progetti»; the recent projects with their thumbnails; the page tools; the way back to
 * Sinopia; and the account card at the foot. One frame on every page (UI-UX-SinopiaCAD §1.4): no «New project»,
 * no «More», no chat tree. Everything sits on an 8 px gutter, with the eyelets starting where the rows' glyphs do.
 */
export function AppSidebar({ ...properties }: React.ComponentProps<typeof Sidebar>): React.JSX.Element {
  const { t } = useTranslation();
  const { state, isMobile } = useSidebar();
  const desktopTarget = isDesktopTarget();
  const isNonMobileCollapsed = !isMobile && state === 'collapsed';

  return (
    <Sidebar
      {...properties}
      id={isMobile ? undefined : 'app-sidebar'}
      role={isMobile ? undefined : 'complementary'}
      aria-label={isMobile ? undefined : t('shell.sidebar.label')}
      aria-hidden={isNonMobileCollapsed || undefined}
      inert={isNonMobileCollapsed || undefined}
      variant='sidebar'
      collapsible={isMobile ? 'offcanvas' : 'none'}
      className={cn('w-full border-r border-sidebar-border', properties.className)}
    >
      {/* On a desktop window the titlebar controls (the toggle and the wordmark) sit over this row. */}
      <SidebarHeader
        className={cn(
          'flex flex-row items-center gap-1',
          isMobile && 'p-1',
          !isMobile && 'h-9 p-0',
          isMobile && desktopTarget && 'h-9 pl-(--desktop-titlebar-inset) [&_:is(a,button)]:[app-region:no-drag]',
        )}
      >
        {isMobile ? <SidebarTrigger /> : null}
        {isMobile ? (
          <SidebarMenuButton
            asChild
            tooltip={t('shell.sidebar.home')}
            className='min-w-0 flex-1 gap-0 p-1! group-data-[collapsible=icon]:p-0!'
          >
            <Link to='/'>
              <SinopiaCadWordmark size='md' />
              <span className='sr-only'>{t('shell.sidebar.home')}</span>
            </Link>
          </SidebarMenuButton>
        ) : null}
      </SidebarHeader>
      <SidebarContent className='gap-0'>
        <nav aria-label={t('shell.sidebar.navigation')} className='sticky top-0 z-10 bg-sidebar px-2 pt-1 pb-2'>
          {/* Global search entries register when search opens. */}
          <Commands />
          <SidebarMenu className='mt-2 gap-0.5'>
            <PrimaryRow to='/' icon={Home} label={t('shell.sidebar.home')} end />
            <PrimaryRow to='/projects' icon={FolderOpen} label={t('shell.nav.projects')} />
          </SidebarMenu>
        </nav>
        <div className='flex-1 [scrollbar-width:thin] overflow-y-auto pb-3'>
          <HomeRecentNavigation />
          <SinopiaToolsNavigation />
        </div>
      </SidebarContent>
      {desktopTarget ? <DesktopUpdate /> : undefined}
      <SidebarFooter className='gap-0 p-0'>
        <SidebarSection label={t('shell.sidebar.sinopia')} className='border-t border-sidebar-border pt-1 pb-2'>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className='text-sidebar-foreground'>
              {/* Another app on the same origin: a full navigation, never a route of this router. */}
              <a href={sinopiaDashboardUrl()} title={t('shell.sidebar.backToSinopiaHint')}>
                <SinopiaMark aria-hidden className='size-4' />
                <span className='flex-1'>{t('shell.sidebar.backToSinopia')}</span>
                <ArrowUpRight aria-hidden className='size-3.5! text-muted-foreground' />
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarSection>
        <div className='border-t border-sidebar-border p-2'>
          <NavUser />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
