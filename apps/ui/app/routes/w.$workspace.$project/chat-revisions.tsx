import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { History, XIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@taucad/ui/components/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@taucad/ui/components/alert-dialog';
import { cn } from '@taucad/ui/utils/cn';
import {
  FloatingPanel,
  FloatingPanelClose,
  FloatingPanelContent,
  FloatingPanelContentBody,
  FloatingPanelContentHeader,
  FloatingPanelContentHeaderActions,
  FloatingPanelContentTitle,
} from '#components/ui/floating-panel.js';
import { useProject } from '#hooks/use-project.js';
import { useRevisions, useRevisionsOnLine, useWithRestoreTargets } from '#hooks/use-revisions.js';
import type { RevisionCard } from '#hooks/use-revisions.js';
import { useProjectRole, useRevisionClient } from '#hooks/use-revision-status.js';
import { useRestoreToPoint } from '#hooks/use-restore-to-point.js';
import { useTranslation, formatTime } from '#i18n/translate.js';
import {
  groupVersionDays,
  parameterChangeSentence,
  versionSummary,
} from '#routes/w.$workspace.$project/revision-history.js';
import type { VersionEvent } from '#routes/w.$workspace.$project/revision-history.js';
import { useSinopiaSendEvents } from '#hooks/use-sinopia-send-events.js';
import { SinopiaConflictVersions } from '#hooks/use-sinopia-cad-conflicts.js';
import { consumeRevisionReveal, useRevisionReveal } from '#routes/w.$workspace.$project/revision-reveal.js';
import { toast } from '#components/ui/sonner.js';

const RevisionPreview = lazy(async () => {
  const module = await import('#routes/w.$workspace.$project/revision-preview.js');
  return { default: module.RevisionPreview };
});

/** The same readable history in the compact panel and the left-hand Versions tab. */
export function ChatRevisions({
  isExpanded = true,
  setIsExpanded,
}: {
  readonly isExpanded?: boolean;
  readonly setIsExpanded?: (value: boolean | ((current: boolean) => boolean)) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <FloatingPanel isOpen={isExpanded} side='left' onOpenChange={setIsExpanded}>
      <FloatingPanelContent>
        <FloatingPanelContentHeader>
          <FloatingPanelContentTitle>{t('versions.title')}</FloatingPanelContentTitle>
          <FloatingPanelContentHeaderActions>
            <FloatingPanelClose icon={XIcon} tooltipContent={(open) => t(open ? 'versions.close' : 'versions.open')} />
          </FloatingPanelContentHeaderActions>
        </FloatingPanelContentHeader>
        <FloatingPanelContentBody className='p-0'>
          <RevisionsPanelBody />
        </FloatingPanelContentBody>
      </FloatingPanelContent>
    </FloatingPanel>
  );
}

function VersionRow({
  revision,
  targets,
  isCurrent,
  isRestorable,
  onView,
  onRestore,
}: {
  readonly revision: RevisionCard;
  readonly targets: readonly RevisionCard[];
  readonly isCurrent: boolean;
  readonly isRestorable: boolean;
  readonly onView: (revision: RevisionCard) => void;
  readonly onRestore: (revision: RevisionCard) => void;
}): React.JSX.Element {
  const { projectId } = useProject();
  const { language, t } = useTranslation();
  const client = useRevisionClient();
  const restoredNumber = targets.find((target) => target.revisionId === revision.restoredFrom)?.n;
  const fallback = versionSummary(revision, t, restoredNumber);
  const { data: detail } = useQuery({
    queryKey: ['version-sentence', projectId, revision.revisionId, language],
    enabled: client !== undefined && revision.restoredFrom === undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async () => {
      const paths = (await client?.diff(revision.revisionId)) ?? [];
      const parameters = paths.filter(({ path }) => path.startsWith('.tau/parameters/')).slice(0, 4);
      const sentences = await Promise.all(
        parameters.map(async ({ path }) => {
          const comparison = await client?.compare(revision.revisionId, path);
          return comparison?.kind === 'text' ? parameterChangeSentence({ ...comparison, language }) : undefined;
        }),
      );
      const changed = sentences.filter((sentence) => sentence !== undefined);
      const first = changed[0];
      return first === undefined
        ? fallback
        : changed.length > 1
          ? t('versions.otherChanges', { change: first })
          : first;
    },
  });
  const name = revision.n === undefined ? t('versions.unnamed') : t('versions.revision', { number: revision.n });
  return (
    <li
      className='group/version relative grid grid-cols-[0.5rem_minmax(0,1fr)] gap-x-2 rounded-md px-2 py-2.5 focus-within:bg-accent/50 hover:bg-accent/50'
      aria-label={name}
    >
      <span
        role={isCurrent ? 'img' : undefined}
        aria-label={isCurrent ? t('versions.current') : undefined}
        aria-hidden={isCurrent ? undefined : true}
        className={cn('mt-1.5 size-1.5 rounded-full', isCurrent && 'bg-primary')}
      />
      <div className='min-w-0'>
        <div className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs'>
          <span className='font-mono font-medium tabular-nums'>{name}</span>
          <span className='text-muted-foreground'>
            {revision.source === 'agent' ? t('versions.agent') : t('versions.you')}
          </span>
          {revision.createdAt > 0 ? (
            <time
              className='ml-auto font-mono text-muted-foreground tabular-nums'
              dateTime={new Date(revision.createdAt).toISOString()}
            >
              {formatTime(revision.createdAt, language)}
            </time>
          ) : null}
        </div>
        <p className='mt-1 text-sm leading-relaxed wrap-break-word'>{detail ?? fallback}</p>
        <div className='mt-1 flex flex-wrap gap-1 opacity-100 sm:opacity-0 sm:group-focus-within/version:opacity-100 sm:group-hover/version:opacity-100 [@media(hover:none)]:opacity-100'>
          <Button
            variant='ghost'
            size='xs'
            onClick={() => {
              onView(revision);
            }}
          >
            {t('versions.view')}
          </Button>
          {isRestorable ? (
            <Button
              variant='ghost'
              size='xs'
              onClick={() => {
                onRestore(revision);
              }}
            >
              {t('versions.restore')}
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** A day-grouped projection of the existing graph; delivery events will be supplied by step 6. */
export function RevisionsPanelBody({ events = [] }: { readonly events?: readonly VersionEvent[] }): React.JSX.Element {
  const { t, language } = useTranslation();
  const { projectId } = useProject();
  const deliveries = useSinopiaSendEvents(projectId);
  const { revisions, headRevisionId, isDirty, isLoading, hasOlder, loadOlder } = useRevisions();
  const role = useProjectRole();
  const { restore, isBusy } = useRestoreToPoint();
  const [shown, setShown] = useState(12);
  const [isPaging, setIsPaging] = useState(false);
  const [preview, setPreview] = useState<RevisionCard>();
  const [pendingRestore, setPendingRestore] = useState<RevisionCard>();
  const revealed = useRevisionReveal(projectId);
  const pinIds = useMemo(
    () => (revealed === undefined || revisions.some((row) => row.revisionId === revealed) ? [] : [revealed]),
    [revealed, revisions],
  );
  const pinned = useRevisionsOnLine(pinIds);
  const rows = useMemo(
    () => [
      ...revisions.slice(0, shown),
      ...pinned.filter((row) => !revisions.slice(0, shown).some((held) => held.revisionId === row.revisionId)),
    ],
    [pinned, revisions, shown],
  );
  const targets = useWithRestoreTargets(rows);
  const requested = revisions.find((row) => row.revisionId === revealed) ?? pinned[0];
  useEffect(() => {
    if (revealed !== undefined && requested !== undefined) {
      // External chat-marker requests open the read-only preview, even before this pane mounts.
      // oxlint-disable-next-line react/set-state-in-effect -- Synchronize an external reveal request.
      setPreview(requested);
      consumeRevisionReveal(projectId, revealed);
    }
  }, [projectId, requested, revealed]);
  const projectScope = useRef(projectId);
  useEffect(() => {
    if (projectScope.current !== projectId) {
      projectScope.current = projectId;
      // oxlint-disable-next-line react/set-state-in-effect -- Clear project-scoped interaction state on an external identity change.
      setPreview(undefined);
      setPendingRestore(undefined);
      setShown(12);
    }
  }, [projectId]);
  const timeline = useMemo(
    () =>
      [
        ...rows.map(
          (revision) =>
            ({
              kind: 'revision',
              id: revision.revisionId,
              createdAt: revision.createdAt,
              revision,
            }) as const,
        ),
        ...deliveries.events,
        ...events.filter((event) => !deliveries.events.some((saved) => saved.id === event.id)),
      ].sort((a, b) => b.createdAt - a.createdAt),
    [rows, events, deliveries.events],
  );
  const days = groupVersionDays(timeline, language);
  const targetName =
    pendingRestore?.n === undefined ? t('versions.unnamed') : t('versions.revision', { number: pendingRestore.n });
  const loadMore = async (): Promise<void> => {
    setIsPaging(true);
    try {
      if (shown >= revisions.length) {
        await loadOlder();
      }
      setShown((count) => count + 12);
    } catch {
      toast.error(t('versions.historyError'));
    } finally {
      setIsPaging(false);
    }
  };
  return (
    <div data-slot='revisions-panel-body' className='flex size-full min-h-0 flex-col bg-sidebar'>
      <div data-testid='versions-list' className='min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-2 py-3'>
        {deliveries.error ? (
          <p role='alert' className='px-2 text-sm'>
            {t('versions.historyError')}
          </p>
        ) : null}
        <SinopiaConflictVersions />
        {isLoading && rows.length === 0 ? (
          <p role='status' className='px-2 text-sm text-muted-foreground'>
            {t('versions.loading')}
          </p>
        ) : timeline.length === 0 ? (
          <div className='flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground'>
            <History aria-hidden className='size-5' />
            <p>{t('versions.empty')}</p>
          </div>
        ) : (
          days.map((day) => (
            <section key={day.key} aria-label={day.label}>
              <h3 className='px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground'>{day.label}</h3>
              <ol>
                {day.rows.map((row) =>
                  row.kind === 'revision' ? (
                    <VersionRow
                      key={row.id}
                      revision={row.revision}
                      targets={targets}
                      isCurrent={row.id === headRevisionId}
                      isRestorable={
                        !isBusy && role !== 'read' && role !== 'revoked' && (row.id !== headRevisionId || isDirty)
                      }
                      onView={setPreview}
                      onRestore={setPendingRestore}
                    />
                  ) : (
                    <li key={row.id} className='flex gap-2 px-2 py-2 text-xs text-muted-foreground'>
                      <span aria-hidden>↑</span>
                      <span>{t('versions.sent', { number: row.versionNumber })}</span>
                      <time className='ml-auto font-mono tabular-nums' dateTime={new Date(row.createdAt).toISOString()}>
                        {formatTime(row.createdAt, language)}
                      </time>
                    </li>
                  ),
                )}
              </ol>
            </section>
          ))
        )}
        {shown < revisions.length || hasOlder ? (
          <Button
            variant='ghost'
            size='sm'
            className='mt-2 w-full'
            disabled={isPaging}
            onClick={() => {
              void loadMore();
            }}
          >
            {t('versions.more')}
          </Button>
        ) : null}
      </div>
      <AlertDialog
        open={pendingRestore !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRestore(undefined);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('versions.confirmTitle', { revision: targetName })}</AlertDialogTitle>
            <AlertDialogDescription>{t('versions.confirmBody', { revision: targetName })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              autoFocus
              variant='outline'
              onClick={() => {
                setPendingRestore(undefined);
              }}
            >
              {t('versions.cancel')}
            </Button>
            <Button
              disabled={isBusy || role === 'read' || role === 'revoked'}
              onClick={() => {
                if (pendingRestore !== undefined) {
                  restore(pendingRestore.revisionId);
                  setPendingRestore(undefined);
                }
              }}
            >
              {t('versions.confirmAction', { revision: targetName })}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {preview === undefined ? null : (
        <Suspense fallback={<p role='status'>{t('versions.previewLoading')}</p>}>
          <RevisionPreview
            key={`${projectId}:${preview.revisionId}`}
            revision={preview}
            onClose={() => {
              setPreview(undefined);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
