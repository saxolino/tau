import { Lock } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { useQueries } from '@tanstack/react-query';
import { useSelector } from '@xstate/react';
import { parameterEntryPath } from '@taucad/types';
import { createSourceModelInteractionUnitId } from '@taucad/viewer/machines/model-interaction.machine';
import { useProject } from '#hooks/use-project.js';
import { useRevisionClient } from '#hooks/use-revision-status.js';
import { useTurnRevision, useRevisionChanges, useRevisionCards } from '#hooks/use-revisions.js';
import { useTranslation } from '#i18n/translate.js';
import { turnModelChanges } from '#lib/turn-model-changes.js';
import type { ModelChange } from '#lib/turn-model-changes.js';

/** One closed summary per confirmed turn, never a list of tool invocations. */
export function TurnSummaryCard({
  changes,
  revision,
  onSelect,
}: {
  readonly changes: readonly ModelChange[];
  readonly revision?: number;
  readonly onSelect: (change: ModelChange) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <details className='mx-4 my-2 rounded-lg border border-border bg-muted/20 text-xs'>
      <summary className='cursor-action px-3 py-2 font-medium focus-visible:focus-outline'>
        {t('agent.changed')}
        {revision === undefined ? '' : ` · Rev ${revision}`}
      </summary>
      <ul className='space-y-1 border-t border-border px-3 py-2'>
        {changes.length === 0 ? (
          <li>{t('agent.fallback')}</li>
        ) : (
          changes.map((change) => (
            <li key={change.id}>
              {change.pieceId ? (
                <Button
                  variant='link'
                  size='xs'
                  className='max-w-full justify-start whitespace-normal'
                  onClick={() => {
                    onSelect(change);
                  }}
                >
                  {change.name}
                </Button>
              ) : (
                <span>{change.name}</span>
              )}
              {change.field ? ` · ${change.field}` : ''}
              {' · '}
              {change.before ?? t('agent.unknown')} → {change.after ?? t('agent.unknown')}
              {change.owned ? (
                <span className='ml-1 inline-flex items-center gap-1'>
                  <Lock aria-hidden='true' className='size-3' />
                  {t('agent.yours')}
                </span>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </details>
  );
}

/** Reopen history from immutable revision data; no view-local before/after cache can lose a turn on remount. */
export function TurnModelSummary({ turnId }: { readonly turnId: string }): React.JSX.Element | undefined {
  const { language } = useTranslation();
  const project = useProject();
  const revision = useTurnRevision(turnId);
  const changed = useRevisionChanges(revision);
  const parent = useRevisionCards(revision?.parent ? [revision.parent] : []).get(revision?.parent ?? '');
  const manualParent =
    parent?.turnId === undefined && (parent?.trigger === 'save' || parent?.trigger === 'idle') ? parent : undefined;
  const client = useRevisionClient();
  const context = useSelector(project.modelInteractionRef, (state) => state.context);
  const units = context.unitOrder.flatMap((id) => {
    const manifest = context.unitsById[id]?.manifest;
    return manifest?.sourceFile ? [{ manifest, path: manifest.sourceFile }] : [];
  });
  const comparisons = useQueries({
    queries: units
      .filter((unit) =>
        changed.some((entry) => entry.path === parameterEntryPath(unit.path) || entry.path === unit.path),
      )
      .map((unit) => ({
        queryKey: ['turn-model-changes', project.projectId, revision?.revisionId, unit.path],
        enabled: client !== undefined && revision !== undefined,
        staleTime: Number.POSITIVE_INFINITY,
        retry: false,
        meta: { handlesErrorLocally: true },
        queryFn: async () => {
          if (!client || !revision) {
            throw new Error('Revision unavailable');
          }
          const comparison = await client.compare(revision.revisionId, parameterEntryPath(unit.path));
          return { path: unit.path, comparison };
        },
      })),
  });
  const manualComparisons = useQueries({
    queries: units.map((unit) => ({
      queryKey: ['turn-manual-parameters', project.projectId, manualParent?.revisionId, unit.path],
      enabled: client !== undefined && manualParent !== undefined,
      staleTime: Number.POSITIVE_INFINITY,
      retry: false,
      meta: { handlesErrorLocally: true },
      queryFn: async () => {
        if (!client || !manualParent) {
          throw new Error('Revision unavailable');
        }
        return {
          path: unit.path,
          comparison: await client.compare(manualParent.revisionId, parameterEntryPath(unit.path)),
        };
      },
    })),
  });
  if (!revision) {
    return undefined;
  }
  const changes = comparisons.flatMap((query) => {
    const { data } = query;
    const manifest = units.find((unit) => unit.path === data?.path)?.manifest;
    const manual = manualComparisons.find((query) => query.data?.path === data?.path)?.data?.comparison;
    const manualPointers = new Set(
      manual?.kind === 'text' ? turnModelChanges({ ...manual, manifest, language }).map((change) => change.id) : [],
    );
    return data?.comparison.kind === 'text'
      ? turnModelChanges({ ...data.comparison, manifest, language, manualPointers }).map((change) => ({
          ...change,
          entryPath: data.path,
          id: `${data.path}:${change.id}`,
        }))
      : [];
  });
  return (
    <TurnSummaryCard
      changes={changes}
      revision={revision.n}
      onSelect={(change) => {
        const { pieceId } = change;
        const unit = units.find(
          (candidate) => candidate.path === change.entryPath && pieceId && candidate.manifest.nodesById[pieceId],
        );
        if (unit && pieceId) {
          project.modelInteractionRef.send({
            type: 'selectComponent',
            unitId: createSourceModelInteractionUnitId(unit.path),
            componentId: pieceId,
            source: 'chat',
          });
        }
      }}
    />
  );
}
