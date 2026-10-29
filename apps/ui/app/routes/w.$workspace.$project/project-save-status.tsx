import { useState } from 'react';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { useSinopiaCadSync } from '#hooks/use-sinopia-cad-sync.js';
import { SinopiaConflictDialog } from '#routes/w.$workspace.$project/sinopia-conflict-dialog.js';
import type { RevisionStatusProjection } from '@taucad/revisions';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { cn } from '@taucad/ui/utils/cn';
import type { RevisionCard } from '#hooks/use-revisions.js';
import { formatTime, useTranslation } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import type { Language } from '#i18n/language.js';
import { useProjectWorkspace } from '#routes/w.$workspace.$project/project-workspace-context.js';
import { useRevisionFacts } from '#routes/w.$workspace.$project/revision-vocabulary.js';
import type { RevisionWhere } from '#routes/w.$workspace.$project/revision-vocabulary.js';

/**
 * Where the model's work stands, in the few states a designer needs (UI-UX-SinopiaCAD §1, choice 4): saved, saving,
 * not yet saved, or a decision waiting. Today it reads the copy on this computer; step 6 points it at the copy on
 * Sinopia («Salvato su Sinopia · 14:02»).
 */
export type SaveStatus =
  | Readonly<{ kind: 'loading' | 'saving' | 'restoring' | 'failed' | 'conflict' | 'unsaved' | 'notSaved' }>
  | Readonly<{ kind: 'saved'; at: number | undefined }>;

/**
 * The save status from the revision owners, most urgent first, as `selectRevisionFacts` orders them: a save that
 * needs a person, a conflict, work in flight, then what the files are. Branches, backups and remotes are not
 * SinopiaCAD's to show.
 *
 * @param status - The revision status projection, `undefined` before the project's root answers.
 * @param where - Where the checkout is.
 * @param head - The head revision's card, once read.
 * @returns The status.
 */
export function selectSaveStatus(
  status: RevisionStatusProjection | undefined,
  where: RevisionWhere,
  head: RevisionCard | undefined,
): SaveStatus {
  if (status === undefined) {
    return { kind: 'loading' };
  }
  if (status.attention - status.conflicts.length > 0) {
    return { kind: 'failed' };
  }
  if (status.conflicts.length > 0 || status.sync.state === 'conflicted') {
    return { kind: 'conflict' };
  }
  if (status.minting) {
    return { kind: 'saving' };
  }
  if (status.restore.busy) {
    return { kind: 'restoring' };
  }
  if (where.isLoading === true && where.head === undefined && !where.isDirty) {
    return { kind: 'loading' };
  }
  if (where.isDirty) {
    return { kind: 'unsaved' };
  }
  if (where.head === undefined) {
    return { kind: 'notSaved' };
  }
  return { kind: 'saved', at: head?.createdAt };
}

/**
 * The status as one sentence in the interface language.
 *
 * @param status - The status.
 * @param t - The translator.
 * @param language - The language, for the time of day.
 * @returns The sentence.
 */
export function saveStatusSentence(status: SaveStatus, t: Translate, language: Language): string {
  switch (status.kind) {
    case 'saved': {
      return status.at === undefined
        ? t('project.saveStatus.saved')
        : t('project.saveStatus.savedAt', { time: formatTime(status.at, language) });
    }
    case 'loading':
    case 'saving':
    case 'restoring':
    case 'failed':
    case 'conflict':
    case 'unsaved':
    case 'notSaved': {
      return t(`project.saveStatus.${status.kind}`);
    }
  }
}

/** The dot before the sentence: its colour repeats the sentence, never replaces it. */
const dotTone: Readonly<Record<SaveStatus['kind'], string>> = {
  saved: 'bg-success',
  loading: 'bg-muted-foreground animate-pulse motion-reduce:animate-none',
  saving: 'bg-muted-foreground animate-pulse motion-reduce:animate-none',
  restoring: 'bg-muted-foreground animate-pulse motion-reduce:animate-none',
  unsaved: 'bg-warning',
  notSaved: 'bg-warning',
  conflict: 'bg-warning',
  failed: 'bg-feature',
};

/**
 * The top bar's save status: a sentence, not an icon or a branch. A status that needs the person (a save not
 * confirmed, a conflict) is a button that opens the Versions, where the decision is made.
 *
 * @returns The status.
 */
function LocalProjectSaveStatus(): React.JSX.Element {
  const { t, language } = useTranslation();
  const { openPanel } = useProjectWorkspace();
  const { where, head, status } = useRevisionFacts();
  const saveStatus = selectSaveStatus(status, where, head);
  const sentence = saveStatusSentence(saveStatus, t, language);
  const dot = <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', dotTone[saveStatus.kind])} />;

  if (saveStatus.kind === 'failed' || saveStatus.kind === 'conflict') {
    return (
      <PaneButton
        size='label'
        data-slot='save-status'
        className='text-foreground'
        onClick={() => {
          openPanel('revisions');
        }}
      >
        {dot}
        <span className='truncate'>{sentence}</span>
      </PaneButton>
    );
  }

  return (
    <span
      role='status'
      data-slot='save-status'
      aria-busy={saveStatus.kind === 'loading' || saveStatus.kind === 'saving' || saveStatus.kind === 'restoring'}
      className='flex min-w-0 items-center gap-2 px-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums'
    >
      {dot}
      <span className='truncate'>{sentence}</span>
    </span>
  );
}

/** Use the acknowledged Sinopia copy in configured builds; retain the local revision owner in standalone builds. */
export function ProjectSaveStatus(): React.JSX.Element {
  const session = useSinopiaSession();
  return session.status === 'disabled' ? <LocalProjectSaveStatus /> : <SinopiaProjectSaveStatus />;
}

function SinopiaProjectSaveStatus(): React.JSX.Element {
  const { t, language } = useTranslation();
  const { state, retry, resolve } = useSinopiaCadSync();
  const [isConflictOpen, setConflictOpen] = useState(false);
  // A newly observed remote conflict (a new conflict, or a new remote head) opens its decision surface. Derived while
  // rendering from the head last seen, so no dependency array has to stand in for a change signal.
  const conflictHead = state.kind === 'conflict' ? (state.remote?.head_revision_id ?? '') : undefined;
  const [seenConflictHead, setSeenConflictHead] = useState<string>();
  if (conflictHead !== seenConflictHead) {
    setSeenConflictHead(conflictHead);
    if (conflictHead !== undefined) {
      setConflictOpen(true);
    }
  }
  const sentence =
    state.kind === 'saved' && state.at !== undefined
      ? t('sinopiaSync.savedAt', { time: formatTime(state.at, language) })
      : t(`sinopiaSync.${state.kind}`);
  // Only a failure «Riprova» can fix offers it; a permanent one (too large, deleted, another account) says why instead.
  const isFailed = state.kind === 'failed' || state.kind === 'linkFailed';
  const tone =
    state.kind === 'saved'
      ? 'bg-success'
      : state.kind === 'loading' || state.kind === 'saving' || state.kind === 'linking' || state.kind === 'idle'
        ? 'bg-muted-foreground'
        : 'bg-warning';
  return (
    <>
      <span
        role='status'
        data-slot='save-status'
        aria-busy={state.kind === 'saving' || state.kind === 'loading' || state.kind === 'linking'}
        className='flex min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground tabular-nums'
      >
        <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tone)} />
        {state.kind === 'conflict' ? (
          <PaneButton
            size='label'
            onClick={() => {
              setConflictOpen(true);
            }}
          >
            {sentence}
          </PaneButton>
        ) : (
          <span className='max-w-80 truncate' title={sentence}>
            {sentence}
          </span>
        )}
        {isFailed ? (
          <PaneButton size='label' onClick={retry}>
            {t('sinopiaSync.retry')}
          </PaneButton>
        ) : null}
      </span>
      <SinopiaConflictDialog
        remote={state.remote}
        isOpen={isConflictOpen && (state.kind === 'conflict' || state.kind === 'saving')}
        isBusy={state.kind === 'saving'}
        onOpenChange={setConflictOpen}
        resolve={resolve}
      />
    </>
  );
}
