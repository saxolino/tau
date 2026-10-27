import { useQueries } from '@tanstack/react-query';
import { useSelector } from '@xstate/react';
import { parameterEntryPath } from '@taucad/types';
import { cn } from '@taucad/ui/utils/cn';
import { createSourceModelInteractionUnitId } from '@taucad/viewer/machines/model-interaction.machine';
import { AssistantChangeCard } from '#components/chat/assistant-change-card.js';
import type { StatoAnnulla } from '#components/chat/assistant-change-card.js';
import { useProject } from '#hooks/use-project.js';
import { useRevisionClient, useRevisionCommands, useRevisionStatus } from '#hooks/use-revision-status.js';
import { useRevisions, useTurnRevision, useRevisionChanges, useRevisionCards } from '#hooks/use-revisions.js';
import type { RevisionCard } from '#hooks/use-revisions.js';
import { useTranslation } from '#i18n/translate.js';
import { turnModelChanges } from '#lib/turn-model-changes.js';
import type { ModelChange } from '#lib/turn-model-changes.js';

/**
 * One closed summary per confirmed turn, never a list of tool invocations: «Cosa ho cambiato · Rev N», each value
 * before → after with its piece, and «Annulla» while the turn is still the last thing that happened (SinopiaCAD D4).
 */
export function TurnSummaryCard({
  changes,
  revision,
  annulla,
  onSelect,
  onChiudi,
  className,
}: {
  readonly changes: readonly ModelChange[];
  readonly revision?: number;
  /** The turn can be taken back as one entry of the history. */
  readonly annulla?: StatoAnnulla;
  readonly onSelect: (change: ModelChange) => void;
  readonly onChiudi?: () => void;
  readonly className?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <AssistantChangeCard
      className={cn('mx-4 my-2', className)}
      titolo={`${t('agent.changed')}${revision === undefined ? '' : ` · Rev ${revision}`}`}
      righe={changes.map((change) => ({
        id: change.id,
        pezzo: change.name,
        selezionabile: change.pieceId !== undefined,
        etichetta: change.field,
        prima: change.before ?? t('agent.unknown'),
        dopo: change.after ?? t('agent.unknown'),
        tuo: change.owned,
      }))}
      vuoto={t('agent.fallback')}
      {...(annulla ? { annulla } : {})}
      {...(onChiudi ? { onChiudi } : {})}
      onSelezionaPezzo={(riga) => {
        const change = changes.find((candidate) => candidate.id === riga.id);
        if (change) {
          onSelect(change);
        }
      }}
    />
  );
}

/**
 * «Annulla» for an agent's turn: the history's own undo (this device's newest operation), offered only while the turn
 * is the head of the line, nothing is unsaved and the history says it can.
 *
 * @param revision - The turn's revision.
 * @returns The undo, or undefined when the turn is no longer the last thing that happened.
 */
export function useTurnUndo(revision: RevisionCard | undefined): StatoAnnulla | undefined {
  const { headRevisionId, isDirty } = useRevisions();
  const status = useRevisionStatus();
  const { undoOperation } = useRevisionCommands();
  const isRestoring = status?.restore.busy === true;
  if (!revision || headRevisionId !== revision.revisionId || isDirty || status?.restore.canUndo !== true) {
    return undefined;
  }
  return isRestoring ? { stato: 'in_corso' } : { stato: 'pronto', onAnnulla: undoOperation };
}

/** Reopen history from immutable revision data; no view-local before/after cache can lose a turn on remount. */
export function TurnModelSummary({
  turnId,
  className,
  onChiudi,
}: {
  readonly turnId: string;
  readonly className?: string;
  readonly onChiudi?: () => void;
}): React.JSX.Element | undefined {
  const { language } = useTranslation();
  const project = useProject();
  const revision = useTurnRevision(turnId);
  const changed = useRevisionChanges(revision);
  const parent = useRevisionCards(revision?.parent ? [revision.parent] : []).get(revision?.parent ?? '');
  const manualParent =
    parent?.turnId === undefined && (parent?.trigger === 'save' || parent?.trigger === 'idle') ? parent : undefined;
  const client = useRevisionClient();
  const annulla = useTurnUndo(revision);
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
      {...(annulla ? { annulla } : {})}
      {...(className === undefined ? {} : { className })}
      {...(onChiudi ? { onChiudi } : {})}
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
