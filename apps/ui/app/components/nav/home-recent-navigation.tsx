import { useMemo } from 'react';
import { Link, useLocation } from 'react-router';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#components/ui/sidebar.js';
import { useProjects } from '#hooks/use-projects.js';
import { useTranslation } from '#i18n/translate.js';
import { projectUrlOr } from '#utils/project-url.utils.js';

/** Every page shows eight recent projects without the workspace's chat and technical controls. */
export function HomeRecentNavigation(): React.JSX.Element {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { projects, isLoading, error, retry } = useProjects();
  const recent = useMemo(
    () => [...projects].sort((left, right) => right.lastActivityAt - left.lastActivityAt).slice(0, 8),
    [projects],
  );
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t('shell.projects.recent')}</SidebarGroupLabel>
      <SidebarMenu>
        {recent.map((project) => {
          const url = projectUrlOr(project.slugs);
          const isCurrent = pathname === url || pathname.startsWith(`${url}/`);
          return (
            <SidebarMenuItem key={project.id}>
              <SidebarMenuButton asChild isActive={isCurrent}>
                <Link to={url} aria-current={isCurrent ? 'page' : undefined}>
                  <span className='line-clamp-2 whitespace-normal'>{project.name}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
        {isLoading && recent.length === 0 ? (
          <li role='status' aria-busy='true' className='px-2 text-xs text-muted-foreground'>
            {t('home.recent.loading')}
          </li>
        ) : null}
        {error !== undefined && recent.length === 0 ? (
          <li role='alert'>
            <SidebarMenuButton
              onClick={() => {
                void retry();
              }}
            >
              {t('home.recent.retry')}
            </SidebarMenuButton>
          </li>
        ) : null}
      </SidebarMenu>
    </SidebarGroup>
  );
}
