import type { IDockviewHeaderActionsProps } from 'dockview-react';
import { PanelLeft } from 'lucide-react';
import { useSelector } from '@xstate/react';
import { Separator } from '@taucad/ui/components/separator';
import { SidebarTrigger, useSidebar } from '#components/ui/sidebar.js';
import { useIsTopRightGroup } from '#components/panes/use-is-top-right-group.js';
import { useProject } from '#hooks/use-project.js';
import { useTranslation } from '#i18n/translate.js';
import { ProjectExportAction } from '#routes/w.$workspace.$project/project-export-action.js';
import { RecordIssuesAction } from '#routes/w.$workspace.$project/record-issues-action.js';
import { useProjectWorkspace } from '#routes/w.$workspace.$project/project-workspace-context.js';

// The variant, not `h-4`: the separator's own `data-[orientation=vertical]:h-full` outranks a bare height.
const GroupSeparator = (): React.JSX.Element => (
  <Separator orientation='vertical' className='data-[orientation=vertical]:h-4' />
);

/**
 * The viewer's top-right cluster where the viewer still shows its tab bar (the narrow, sheet-based layout): the
 * sidebar trigger with the project's name, the settings-records trigger when a record needs a person, and «Esporta».
 * On the desktop the viewer's tab bar is hidden and the project's top bar (`ProjectTopBar`) holds these actions.
 * SinopiaCAD drops Tau's branch chip, Share and the agent toggle here (UI-UX-SinopiaCAD §3.1).
 *
 * @param properties - Dockview's header-action props for the group.
 * @returns The cluster in the top-right group, nothing in every other.
 */
export function ProjectWorkspaceActions(properties: IDockviewHeaderActionsProps): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const { registerRecordRecoveryFocus, restoreRecordRecoveryFocus } = useProjectWorkspace();
  const isTopRight = useIsTopRightGroup(properties.group, properties.containerApi);
  const { projectRef } = useProject();
  const { isMobile, openMobile } = useSidebar();
  const projectName =
    useSelector(projectRef, (snapshot) => snapshot.context.project?.name) ?? t('project.topBar.nameFallback');

  // The desktop's top bar holds these; only the narrow layout still shows the viewer's tab bar.
  if (!isTopRight || !isMobile) {
    return undefined;
  }

  return (
    <div role='group' aria-label={t('project.topBar.actions')} className='flex h-full shrink-0 items-center gap-1'>
      {openMobile ? null : (
        <SidebarTrigger className='h-7 w-auto max-w-44 gap-1.5 px-2'>
          <PanelLeft aria-hidden className='size-3.5 shrink-0' />
          <span className='hidden truncate @xl/viewer:inline'>{projectName}</span>
        </SidebarTrigger>
      )}
      <GroupSeparator />
      {/* Settings records that need a person; nothing while every record is fine. */}
      <RecordIssuesAction fallbackFocus={restoreRecordRecoveryFocus} />
      <ProjectExportAction ref={registerRecordRecoveryFocus} />
    </div>
  );
}
