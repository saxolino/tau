import { memo, useMemo } from 'react';
import { Box } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { SidebarMenuButton, SidebarMenuItem } from '#components/ui/sidebar.js';
import { SidebarSection } from '#components/nav/sidebar-section.js';
import { useProjects } from '#hooks/use-projects.js';
import { useProjectThumbnail } from '#hooks/use-project-thumbnail.js';
import { useTranslation } from '#i18n/translate.js';
import type { ProjectListItem } from '#types/project-library.types.js';
import { isPlaceholderProjectName } from '#utils/project-name.utils.js';
import { projectUrlOr } from '#utils/project-url.utils.js';
import { cn } from '@taucad/ui/utils/cn';

/** How many recent projects the sidebar lists on every page. */
export const sidebarRecentProjectLimit = 8;

/** One recent project: its saved 3D thumbnail (or the box mark) beside its name, current on its own page. */
const RecentProjectRow = memo(function RecentProjectRow({
  project,
  isCurrent,
}: Readonly<{ project: ProjectListItem; isCurrent: boolean }>): React.JSX.Element {
  const { t } = useTranslation();
  const thumbnail = useProjectThumbnail(project.id);
  const name = isPlaceholderProjectName(project.name) ? t('shell.projects.untitled') : project.name;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isCurrent} className='h-8 gap-2.5'>
        <Link to={projectUrlOr(project.slugs)} aria-current={isCurrent ? 'page' : undefined}>
          <span
            aria-hidden
            data-slot='recent-thumbnail'
            className={cn(
              'flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border/60 bg-muted',
              isCurrent && 'border-titanium',
            )}
          >
            {thumbnail.url === undefined ? (
              <Box className='size-3 text-muted-foreground' />
            ) : (
              <img src={thumbnail.url} alt='' className='size-full object-cover' draggable={false} />
            )}
          </span>
          <span className='truncate'>{name}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});

/**
 * «Recenti»: the last projects worked on, with their thumbnails, on every page (UI-UX-SinopiaCAD §1.4). A project
 * whose name is still Tau's or Sinopia's English placeholder is listed as «Senza nome».
 *
 * @returns The section, or nothing while there is nothing to list and nothing to say.
 */
export function HomeRecentNavigation(): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { projects, isLoading, error, retry } = useProjects();
  const recent = useMemo(
    () =>
      [...projects]
        .sort((left, right) => right.lastActivityAt - left.lastActivityAt)
        .slice(0, sidebarRecentProjectLimit),
    [projects],
  );
  if (recent.length === 0 && !isLoading && error === undefined) {
    return undefined;
  }
  return (
    <SidebarSection label={t('shell.sidebar.recent')} className='pt-4'>
      {recent.map((project) => {
        const url = projectUrlOr(project.slugs);
        return (
          <RecentProjectRow
            key={project.id}
            project={project}
            isCurrent={pathname === url || pathname.startsWith(`${url}/`)}
          />
        );
      })}
      {isLoading && recent.length === 0 ? (
        <li role='status' aria-busy='true' className='px-1.5 py-1 text-xs text-muted-foreground'>
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
    </SidebarSection>
  );
}
