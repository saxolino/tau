import { Link } from 'react-router';
import { useState } from 'react';
import { useSelector } from '@xstate/react';
import { ChevronRight, Download, History, Send } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { Separator } from '@taucad/ui/components/separator';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { InlineTextEditor } from '#components/inline-text-editor.js';
import { useProject } from '#hooks/use-project.js';
import { useProjects } from '#hooks/use-projects.js';
import { useTranslation } from '#i18n/translate.js';
import { InspectorLaneToggle } from '#routes/w.$workspace.$project/inspector-lane.js';
import { ProjectSaveStatus } from '#routes/w.$workspace.$project/project-save-status.js';
import {
  projectWorkspaceKeyCombinations,
  useProjectWorkspace,
} from '#routes/w.$workspace.$project/project-workspace-context.js';
import { RecordIssuesAction } from '#routes/w.$workspace.$project/record-issues-action.js';
import { WorkbenchLaneToggle } from '#routes/w.$workspace.$project/workbench-toggle.js';
import { SendToSinopiaDialog } from '#routes/w.$workspace.$project/send-to-sinopia-dialog.js';
import { useSinopiaCadLink, useSinopiaCadLinking } from '#hooks/use-sinopia-cad-sync.js';

/** Labels in the top bar give way to their glyphs when the bar is narrower than `@4xl` (56 rem). */
const topBarFold = {
  className: '@max-4xl/topbar:w-7 @max-4xl/topbar:px-0',
  labelClassName: 'hidden @4xl/topbar:inline',
} as const;

/** The project's name, renamed in place: click, type, Enter (Escape keeps the old one). */
function ProjectName(): React.JSX.Element {
  const { t } = useTranslation();
  const { projectRef, projectId } = useProject();
  const { updateName } = useProjects();
  const name = useSelector(projectRef, (snapshot) => snapshot.context.project?.name);

  return (
    <InlineTextEditor
      value={name ?? t('project.topBar.nameFallback')}
      variant='ghost'
      ariaLabel={t('project.topBar.rename')}
      saveLabel={t('common.save')}
      isDisabled={name === undefined}
      className='h-7 max-w-[min(26rem,36vw)] min-w-0 text-foreground [&_[data-slot=display-text]]:font-medium'
      renderDisplay={(value) => (
        <span data-slot='display-text' className='truncate' title={t('project.topBar.renameHint')}>
          {value}
        </span>
      )}
      onSave={async (next) => {
        await updateName(projectId, next);
      }}
    />
  );
}

/**
 * The project page's one top bar (UI-UX-SinopiaCAD §3.1), across Misure, the model and the inspector. On the left the
 * Misure toggle, the path «SinopiaCAD › name» (the name renames in place) and, beside the name, where the work is
 * saved, in words. On the right one filled action, «Invia a Sinopia»; Versioni and Esporta are glyphs with their name in
 * the tooltip; then the inspector's toggle. There is one work mode: no Assistente/Modifica switch, nothing to choose
 * before working. No branch, no Share, no file names.
 *
 * @returns The bar.
 */
export function ProjectTopBar(): React.JSX.Element {
  const { t } = useTranslation();
  const { openPanel, registerRecordRecoveryFocus, restoreRecordRecoveryFocus } = useProjectWorkspace();
  const [isSendOpen, setSendOpen] = useState(false);
  const link = useSinopiaCadLink();
  const linking = useSinopiaCadLinking();

  return (
    // A named region, not a `header`: inside the page's `main` a header has no landmark role to carry the name.
    <section
      aria-label={t('project.topBar.label')}
      data-slot='project-top-bar'
      className={
        // The window's own controls float over the bar's start while the sidebar is closed; the bar leaves them room.
        '@container/topbar flex h-12 shrink-0 items-center gap-2 bg-sidebar pr-3 pl-1 md:group-data-[sidebar-open=false]/app-shell:pl-(--titlebar-controls-width)'
      }
    >
      <WorkbenchLaneToggle place='viewer' fold={topBarFold} />
      <Separator orientation='vertical' className='mx-1 data-[orientation=vertical]:h-4' />
      <nav aria-label={t('project.topBar.breadcrumb')} className='flex min-w-0 shrink items-center'>
        <ol className='flex min-w-0 items-center gap-0.5 text-sm'>
          <li className='hidden shrink-0 @3xl/topbar:list-item'>
            <Link
              to='/projects'
              aria-label={t('project.topBar.projects')}
              title={t('project.topBar.projects')}
              className='rounded-sm px-1.5 py-1 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:focus-outline'
            >
              SinopiaCAD
            </Link>
          </li>
          <li aria-hidden className='hidden shrink-0 text-muted-foreground @3xl/topbar:list-item'>
            <ChevronRight className='size-3.5' />
          </li>
          <li aria-current='page' className='min-w-0'>
            <ProjectName />
          </li>
        </ol>
      </nav>
      <div className='hidden min-w-0 shrink @2xl/topbar:flex'>
        <ProjectSaveStatus />
      </div>
      <div className='min-w-2 flex-1' />
      <div role='group' aria-label={t('project.topBar.actions')} className='flex shrink-0 items-center gap-1'>
        {/* Settings records that need a person; nothing while every record is fine. */}
        <RecordIssuesAction fallbackFocus={restoreRecordRecoveryFocus} />
        <PaneButton
          // Where focus returns after a settings record is repaired (it was Share's, which SinopiaCAD hides).
          ref={registerRecordRecoveryFocus}
          aria-label={t('project.topBar.versions')}
          tooltip={t('project.topBar.versionsTooltip')}
          tooltipSide='bottom'
          onClick={() => {
            openPanel('revisions');
          }}
        >
          <History aria-hidden className='size-3.5' />
        </PaneButton>
        <PaneButton
          aria-label={t('project.topBar.export')}
          aria-keyshortcuts='Control+D'
          tooltipSide='bottom'
          tooltip={
            <span className='flex items-center gap-2'>
              {t('project.topBar.exportTooltip')}
              <KeyShortcut variant='tooltip'>
                {formatKeyCombination(projectWorkspaceKeyCombinations.export)}
              </KeyShortcut>
            </span>
          }
          onClick={() => {
            openPanel('export');
          }}
        >
          <Download aria-hidden className='size-3.5' />
        </PaneButton>
        {/* The page's one filled action: a version of the model goes to the Sinopia project. */}
        <Button
          size='sm'
          className='ml-1'
          aria-label={t('project.topBar.sendToSinopia')}
          onClick={() => {
            setSendOpen(true);
          }}
        >
          <Send aria-hidden className='size-3.5' />
          <span className={topBarFold.labelClassName}>{t('project.topBar.sendToSinopia')}</span>
        </Button>
        {isSendOpen ? (
          <SendToSinopiaDialog isOpen={isSendOpen} onOpenChange={setSendOpen} link={link} linking={linking} />
        ) : null}
        <Separator orientation='vertical' className='mx-1 data-[orientation=vertical]:h-4' />
        <InspectorLaneToggle place='viewer' fold={topBarFold} />
      </div>
    </section>
  );
}
