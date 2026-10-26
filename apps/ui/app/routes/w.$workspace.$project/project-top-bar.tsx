import { Link } from 'react-router';
import { useState } from 'react';
import { useSelector } from '@xstate/react';
import { ChevronRight, Download, History, Send, SlidersHorizontal } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { Separator } from '@taucad/ui/components/separator';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { InlineTextEditor } from '#components/inline-text-editor.js';
import { useProject } from '#hooks/use-project.js';
import { useProjects } from '#hooks/use-projects.js';
import { useTranslation } from '#i18n/translate.js';
import { ChatLaneToggle } from '#routes/w.$workspace.$project/chat-lane-toggle.js';
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
      className='h-7 max-w-80 min-w-0 text-foreground [&_[data-slot=display-text]]:font-medium'
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
 * The project page's one top bar (UI-UX-SinopiaCAD §3.1), across Misure, the model and the agent: on the left the
 * Misure toggle and the path «Progetti › name» (the name renames in place), on the right the save status in words,
 * «Versioni», «Esporta», «Invia a Sinopia» and the «Agente» toggle. No branch, no Share, no file names: those are
 * Tau's and stay out of a designer's way. «Invia a Sinopia» opens the version handoff for the linked project.
 *
 * @returns The bar.
 */
export function ProjectTopBar(): React.JSX.Element {
  const { t } = useTranslation();
  const {
    openPanel,
    registerRecordRecoveryFocus,
    restoreRecordRecoveryFocus,
    manualOpen,
    setManualOpen,
    manualAvailable,
  } = useProjectWorkspace();
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
      <nav aria-label={t('project.topBar.breadcrumb')} className='flex min-w-0 items-center'>
        <ol className='flex min-w-0 items-center gap-0.5 text-sm'>
          <li className='shrink-0'>
            <Link
              to='/projects'
              aria-label={t('project.topBar.projects')}
              title={t('project.topBar.projects')}
              className='rounded-sm px-1.5 py-1 font-medium text-foreground outline-none hover:text-foreground focus-visible:focus-outline'
            >
              SinopiaCAD
            </Link>
          </li>
          <li aria-hidden className='shrink-0 text-muted-foreground'>
            <ChevronRight className='size-3.5' />
          </li>
          <li aria-current='page' className='min-w-0'>
            <ProjectName />
          </li>
        </ol>
      </nav>
      <div className='min-w-2 flex-1' />
      <div role='group' aria-label={t('project.topBar.actions')} className='flex min-w-0 shrink items-center gap-1'>
        <ProjectSaveStatus />
        {/* Settings records that need a person; nothing while every record is fine. */}
        <RecordIssuesAction fallbackFocus={restoreRecordRecoveryFocus} />
        <PaneButton
          // Where focus returns after a settings record is repaired (it was Share's, which SinopiaCAD hides).
          ref={registerRecordRecoveryFocus}
          size='label'
          className={topBarFold.className}
          aria-label={t('project.topBar.versions')}
          tooltip={t('project.topBar.versionsTooltip')}
          tooltipSide='bottom'
          onClick={() => {
            openPanel('revisions');
          }}
        >
          <History aria-hidden className='size-3.5' />
          <span className={topBarFold.labelClassName}>{t('project.topBar.versions')}</span>
        </PaneButton>
        <PaneButton
          size='label'
          className={topBarFold.className}
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
          <span className={topBarFold.labelClassName}>{t('project.topBar.export')}</span>
        </PaneButton>
        <Button
          variant='ghost'
          size='xs'
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
        <div
          role='group'
          aria-label={t('project.topBar.designTools')}
          className='flex items-center gap-1 rounded-lg border bg-background p-0.5'
        >
          <ChatLaneToggle place='viewer' fold={{ className: '', labelClassName: 'inline' }} />
          <Button
            variant={manualOpen ? 'secondary' : 'ghost'}
            size='xs'
            disabled={!manualAvailable}
            aria-pressed={manualOpen}
            aria-label={t('project.topBar.modify')}
            onClick={() => {
              setManualOpen(!manualOpen);
            }}
          >
            <SlidersHorizontal aria-hidden className='size-3.5' />
            {t('project.topBar.modify')}
          </Button>
        </div>
      </div>
    </section>
  );
}
