import * as React from 'react';
import { Link, useMatch } from 'react-router';
import { Home } from 'lucide-react';
import { HomeRecentNavigation } from '#components/nav/home-recent-navigation.js';
import { NavMain } from '#components/nav/nav-main.js';
import { SinopiaToolsNavigation } from '#components/nav/sinopia-tools-navigation.js';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from '#components/ui/sidebar.js';
import { SinopiaCadWordmark } from '#components/icons/sinopiacad-wordmark.js';
import { navRoutes } from '#constants/route.constants.js';
import { Commands } from '#components/layout/command-palette.js';
import { DesktopUpdate } from '#components/nav/desktop-update.js';
import { NavUser } from '#components/nav/nav-user.js';
import { isDesktopTarget } from '#lib/build-target.js';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';

export function AppSidebar({ ...properties }: React.ComponentProps<typeof Sidebar>): React.JSX.Element {
  const { t } = useTranslation();
  const isHome = useMatch('/') !== null;
  const { state, isMobile } = useSidebar();
  const desktopTarget = isDesktopTarget();
  const isCompact = desktopTarget && !isMobile;
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
      className={cn(
        'w-full border-r border-sidebar-border',
        isCompact && '[&_[data-slot=sidebar-group-label]]:text-muted-foreground',
        properties.className,
      )}
    >
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
        <div className='sticky top-0 z-10 space-y-1 bg-sidebar px-2 pb-1'>
          {/* Global search entries register when search opens. */}
          <Commands />
          {/* One frame on every page (UI-UX-SinopiaCAD §1.4): no «New project», no «More», no chat tree. */}
          <SidebarMenuButton asChild isActive={isHome}>
            <Link to='/' aria-current={isHome ? 'page' : undefined}>
              <Home aria-hidden />
              <span>{t('shell.sidebar.home')}</span>
            </Link>
          </SidebarMenuButton>
        </div>
        <div className='flex-1 overflow-y-auto'>
          <div className='flex flex-col justify-between'>
            <NavMain items={navRoutes.navMain} className={isCompact ? 'py-1' : undefined} />
            <HomeRecentNavigation />
            <SinopiaToolsNavigation />
          </div>
        </div>
      </SidebarContent>
      {desktopTarget ? <DesktopUpdate /> : undefined}
      <SidebarFooter className='border-t p-1'>
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
