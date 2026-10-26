import { randomUuid } from '@taucad/utils/id';
import { useState } from 'react';
import { manualDocumentSchema } from '@taucad/smlib/manual-operations';
import type { ManualDocument, ManualOperation } from '@taucad/smlib/manual-operations';
import { Button } from '@taucad/ui/components/button';
import { Input } from '@taucad/ui/components/input';
import { useTranslation } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import {
  ManualChoice,
  ManualNumberField,
  ManualVectorFields,
  manualPlanes,
} from '#routes/w.$workspace.$project/manual-edit-fields.js';
import { ManualProfileEditor } from '#routes/w.$workspace.$project/manual-edit-profile.js';

const toolTypes = ['extrude', 'translate', 'rotate', 'scale', 'mirror', 'hole', 'fillet', 'chamfer'] as const;
type Tool = (typeof toolTypes)[number];
type Commit = (document: ManualDocument) => Promise<boolean>;
type Draft = { base: ManualDocument; operation: ManualOperation; commit: Commit; isNew: boolean };

/** Shared controls for picking a native planar face and editing its signed extrusion. */
export type ManualFaceControls = Readonly<{
  enabled: boolean;
  available: boolean;
  selected?: Readonly<{ name: string; faceIndex: number }>;
  distance: number;
  error?: string;
  onEnableChange: (enabled: boolean) => void;
  onDistanceChange: (distance: number) => void;
  onApply: () => void;
  onCancel: () => void;
}>;

function newOperation(type: Tool, targetName: string, name: string): ManualOperation {
  const id = randomUuid();
  const target = { name: targetName };
  switch (type) {
    case 'extrude': {
      return {
        id,
        type,
        mode: 'new',
        name,
        distance: 10,
        profile: {
          kind: 'polygon',
          plane: 'xy',
          origin: [0, 0, 0],
          points: [
            { id: randomUuid(), x: -10, y: -10 },
            { id: randomUuid(), x: 10, y: -10 },
            { id: randomUuid(), x: 10, y: 10 },
            { id: randomUuid(), x: -10, y: 10 },
          ],
        },
      };
    }
    case 'translate': {
      return { id, type, target, delta: [0, 0, 0] };
    }
    case 'rotate': {
      return { id, type, target, origin: [0, 0, 0], axis: [0, 0, 1], angle: 45 };
    }
    case 'scale': {
      return { id, type, target, origin: [0, 0, 0], factor: 1 };
    }
    case 'mirror': {
      return { id, type, target, origin: [0, 0, 0], plane: 'yz' };
    }
    case 'hole': {
      return { id, type, target, center: [0, 0, -10], axis: [0, 0, 1], diameter: 5, depth: 20 };
    }
    case 'fillet':
    case 'chamfer': {
      return { id, type, target, edges: { kind: 'all' }, size: 1 };
    }
  }
}

function OperationFields({
  operation,
  targets,
  onChange,
  t,
}: Readonly<{
  operation: ManualOperation;
  targets: readonly string[];
  onChange: (operation: ManualOperation) => void;
  t: Translate;
}>): React.JSX.Element {
  const targetChoice = (
    <ManualChoice
      label={t('manualEdit.target')}
      value={operation.target?.name ?? ''}
      choices={targets.map((name) => ({ value: name, label: name }))}
      onChange={(name) => {
        onChange({ ...operation, target: { name } });
      }}
    />
  );
  const fields = (): React.ReactNode => {
    switch (operation.type) {
      case 'faceExtrude': {
        return (
          <>
            <p className='text-xs text-muted-foreground'>
              {t('manualEdit.faceSelected', { name: operation.target.name, number: operation.face.index + 1 })}
            </p>
            <ManualNumberField
              label={t('manualEdit.faceDistance')}
              value={operation.distance}
              onChange={(distance) => {
                onChange({ ...operation, distance });
              }}
            />
            <p className='text-xs text-muted-foreground'>{t('manualEdit.faceDistanceHelp')}</p>
          </>
        );
      }
      case 'translate': {
        return (
          <ManualVectorFields
            label={t('manualEdit.delta')}
            value={operation.delta}
            onChange={(delta) => {
              onChange({ ...operation, delta });
            }}
          />
        );
      }
      case 'rotate': {
        return (
          <>
            <ManualNumberField
              label={t('manualEdit.angle')}
              value={operation.angle}
              unit='°'
              step={1}
              onChange={(angle) => {
                onChange({ ...operation, angle });
              }}
            />
            <ManualVectorFields
              label={t('manualEdit.axis')}
              value={operation.axis}
              unit=''
              onChange={(axis) => {
                onChange({ ...operation, axis });
              }}
            />
            <ManualVectorFields
              label={t('manualEdit.origin')}
              value={operation.origin}
              onChange={(origin) => {
                onChange({ ...operation, origin });
              }}
            />
          </>
        );
      }
      case 'scale': {
        return (
          <>
            <ManualNumberField
              label={t('manualEdit.factor')}
              value={operation.factor}
              unit='×'
              step={0.01}
              onChange={(factor) => {
                onChange({ ...operation, factor });
              }}
            />
            <ManualVectorFields
              label={t('manualEdit.origin')}
              value={operation.origin}
              onChange={(origin) => {
                onChange({ ...operation, origin });
              }}
            />
          </>
        );
      }
      case 'mirror': {
        return (
          <>
            <ManualChoice
              label={t('manualEdit.plane')}
              value={operation.plane}
              choices={manualPlanes}
              onChange={(plane) => {
                if (plane === 'xy' || plane === 'xz' || plane === 'yz') {
                  onChange({ ...operation, plane });
                }
              }}
            />
            <ManualVectorFields
              label={t('manualEdit.origin')}
              value={operation.origin}
              onChange={(origin) => {
                onChange({ ...operation, origin });
              }}
            />
          </>
        );
      }
      case 'hole': {
        return (
          <>
            <ManualNumberField
              label={t('manualEdit.diameter')}
              value={operation.diameter}
              onChange={(diameter) => {
                onChange({ ...operation, diameter });
              }}
            />
            <ManualNumberField
              label={t('manualEdit.depth')}
              value={operation.depth}
              onChange={(depth) => {
                onChange({ ...operation, depth });
              }}
            />
            <ManualVectorFields
              label={t('manualEdit.center')}
              value={operation.center}
              onChange={(center) => {
                onChange({ ...operation, center });
              }}
            />
            <ManualVectorFields
              label={t('manualEdit.axis')}
              value={operation.axis}
              unit=''
              onChange={(axis) => {
                onChange({ ...operation, axis });
              }}
            />
          </>
        );
      }
      case 'fillet':
      case 'chamfer': {
        return (
          <>
            <ManualNumberField
              label={t('manualEdit.size')}
              value={operation.size}
              onChange={(size) => {
                onChange({ ...operation, size });
              }}
            />
            <ManualChoice
              label={t('manualEdit.edges')}
              value={operation.edges.kind}
              choices={[
                { value: 'all', label: t('manualEdit.allEdges') },
                { value: 'parallel', label: t('manualEdit.parallelEdges') },
                ...(operation.edges.kind === 'indices'
                  ? [{ value: 'indices', label: t('manualEdit.guardedEdges') }]
                  : []),
              ]}
              onChange={(kind) => {
                if (kind === 'all') {
                  onChange({ ...operation, edges: { kind } });
                }
                if (kind === 'parallel') {
                  onChange({ ...operation, edges: { kind, axis: [0, 0, 1] } });
                }
              }}
            />
            {operation.edges.kind === 'parallel' ? (
              <ManualVectorFields
                label={t('manualEdit.axis')}
                value={operation.edges.axis}
                unit=''
                onChange={(axis) => {
                  onChange({ ...operation, edges: { kind: 'parallel', axis } });
                }}
              />
            ) : null}
          </>
        );
      }
      case 'extrude': {
        return (
          <>
            <ManualChoice
              label={t('manualEdit.mode')}
              value={operation.mode}
              choices={[
                { value: 'new', label: t('manualEdit.new') },
                ...(targets.length > 0
                  ? [
                      { value: 'add', label: t('manualEdit.add') },
                      { value: 'cut', label: t('manualEdit.cut') },
                    ]
                  : []),
              ]}
              onChange={(mode) => {
                const { name: _name, target: _target, ...rest } = operation;
                if (mode === 'new') {
                  onChange({ ...rest, mode, name: t('manualEdit.newName') });
                }
                if (mode === 'add' || mode === 'cut') {
                  onChange({ ...rest, mode, target: { name: targets[0] ?? '' } });
                }
              }}
            />
            {operation.mode === 'new' ? (
              <label className='block space-y-1 text-xs'>
                {t('manualEdit.name')}
                <Input
                  value={operation.name ?? ''}
                  onChange={(event) => {
                    onChange({ ...operation, name: event.target.value });
                  }}
                />
              </label>
            ) : (
              targetChoice
            )}
            <ManualNumberField
              label={t('manualEdit.depth')}
              value={operation.distance}
              onChange={(distance) => {
                onChange({ ...operation, distance });
              }}
            />
            <ManualChoice
              label={t('manualEdit.plane')}
              value={operation.profile.plane}
              choices={manualPlanes}
              onChange={(plane) => {
                if (plane === 'xy' || plane === 'xz' || plane === 'yz') {
                  onChange({ ...operation, profile: { ...operation.profile, plane } });
                }
              }}
            />
            <ManualVectorFields
              label={t('manualEdit.origin')}
              value={operation.profile.origin}
              onChange={(origin) => {
                onChange({ ...operation, profile: { ...operation.profile, origin } });
              }}
            />
            <ManualProfileEditor
              profile={operation.profile}
              onChange={(profile) => {
                onChange({ ...operation, profile });
              }}
            />
          </>
        );
      }
    }
  };
  return (
    <div className='space-y-3'>
      {operation.type === 'extrude' || operation.type === 'faceExtrude' ? null : targetChoice}
      {fields()}
    </div>
  );
}

function operationTargets(
  document: ManualDocument | undefined,
  draft: Draft | undefined,
  targets: readonly string[],
): string[] {
  const draftIndex =
    draft && !draft.isNew
      ? draft.base.operations.findIndex((operation) => operation.id === draft.operation.id)
      : (document?.operations.length ?? 0);
  const earlierOperations = (draft?.base ?? document)?.operations.slice(0, draftIndex) ?? [];
  const named = earlierOperations.flatMap((operation) =>
    operation.enabled !== false && operation.type === 'extrude' && operation.mode === 'new' && operation.name
      ? [operation.name]
      : [],
  );
  return [...new Set([...targets, ...named])];
}

/** Nonmodal native geometry tools; a draft retains its exact authoring snapshot until saved or discarded. */
export function ManualEditPanel({
  document,
  targets,
  onCommit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isLoading = false,
  isSaving = false,
  error,
  onClose,
  faceControls,
}: Readonly<{
  document: ManualDocument | undefined;
  targets: readonly string[];
  onCommit: Commit;
  onUndo: () => Promise<boolean>;
  onRedo: () => Promise<boolean>;
  canUndo: boolean;
  canRedo: boolean;
  isLoading?: boolean;
  isSaving?: boolean;
  error?: string;
  onClose?: () => void;
  faceControls?: ManualFaceControls;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>();
  const [localError, setLocalError] = useState<string>();
  const [hasSaved, setHasSaved] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const busy = isLoading || isSaving || isCommitting;
  const stale = draft !== undefined && document !== draft.base;
  const choices = operationTargets(document, draft, targets);
  const startDraft = (operation: ManualOperation, isNew: boolean): void => {
    if (!document) {
      return;
    }
    faceControls?.onEnableChange(false);
    setDraft({ base: document, operation, commit: onCommit, isNew });
    setLocalError(undefined);
    setHasSaved(false);
  };
  const saveDocument = async (next: ManualDocument, commit: Commit = onCommit): Promise<boolean> => {
    setLocalError(undefined);
    setHasSaved(false);
    const parsed = manualDocumentSchema.safeParse(next);
    if (!parsed.success) {
      setLocalError(t('manualEdit.invalid', { detail: parsed.error.issues.map((issue) => issue.message).join(' ') }));
      return false;
    }
    setIsCommitting(true);
    try {
      const saved = await commit(parsed.data);
      if (saved) {
        setHasSaved(true);
      } else {
        setLocalError(t('manualEdit.saveFailed'));
      }
      return saved;
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t('manualEdit.saveFailed'));
      return false;
    } finally {
      setIsCommitting(false);
    }
  };
  const saveDraft = async (): Promise<void> => {
    if (!draft || stale || busy) {
      return;
    }
    const operations = draft.isNew
      ? [...draft.base.operations, draft.operation]
      : draft.base.operations.map((operation) => (operation.id === draft.operation.id ? draft.operation : operation));
    if (await saveDocument({ version: 1, operations }, draft.commit)) {
      setDraft(undefined);
    }
  };
  const mutateHistory = (operations: ManualOperation[]): void => {
    if (document && !busy && !draft) {
      void saveDocument({ version: 1, operations });
    }
  };
  return (
    <aside
      aria-label={t('manualEdit.title')}
      data-testid='manual-edit-panel'
      className='flex h-full min-h-0 w-full flex-col border-l border-border bg-background text-foreground'
    >
      <div className='flex items-center justify-between gap-2 border-b border-border p-3'>
        <h2 className='text-sm font-medium'>{t('manualEdit.title')}</h2>
        {onClose ? (
          <Button size='xs' variant='ghost' onClick={onClose}>
            {t('manualEdit.close')}
          </Button>
        ) : null}
      </div>
      <div
        className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3'
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <p className='text-xs text-muted-foreground'>{t('manualEdit.intro')}</p>
        <div className='flex flex-wrap gap-1'>
          <Button
            size='xs'
            variant='outline'
            disabled={!canUndo || busy || Boolean(draft)}
            onClick={() => {
              void onUndo();
            }}
          >
            {t('manualEdit.undo')}
          </Button>
          <Button
            size='xs'
            variant='outline'
            disabled={!canRedo || busy || Boolean(draft)}
            onClick={() => {
              void onRedo();
            }}
          >
            {t('manualEdit.redo')}
          </Button>
        </div>
        {isLoading ? (
          <p role='status' className='text-xs'>
            {t('manualEdit.loading')}
          </p>
        ) : null}
        {(error ?? localError) ? (
          <p role='alert' className='text-xs text-destructive'>
            {localError ?? error}
          </p>
        ) : null}
        {hasSaved ? (
          <p role='status' className='text-xs'>
            {t('manualEdit.saved')}
          </p>
        ) : null}
        {choices.length === 0 ? <p className='text-xs text-muted-foreground'>{t('manualEdit.noTargets')}</p> : null}
        <section aria-label={t('manualEdit.tools')} className='grid grid-cols-2 gap-1'>
          {faceControls ? (
            <Button
              size='sm'
              variant={faceControls.enabled ? 'secondary' : 'outline'}
              aria-pressed={faceControls.enabled}
              disabled={busy || Boolean(draft) || !document || !faceControls.available}
              onClick={() => {
                faceControls.onEnableChange(!faceControls.enabled);
              }}
            >
              {t('manualEdit.faceExtrude')}
            </Button>
          ) : null}
          {toolTypes.map((type) => (
            <Button
              key={type}
              size='sm'
              variant='outline'
              disabled={busy || Boolean(draft) || !document || (type !== 'extrude' && choices.length === 0)}
              onClick={() => {
                const names = new Set([
                  ...targets,
                  ...(document?.operations.flatMap((operation) =>
                    operation.type === 'extrude' && operation.name ? [operation.name] : [],
                  ) ?? []),
                ]);
                let count = 1;
                let name = t('manualEdit.newName');
                while (names.has(name)) {
                  name = `${t('manualEdit.newName')} ${++count}`;
                }
                startDraft(newOperation(type, choices[0] ?? '', name), true);
              }}
            >
              {t(`manualEdit.${type}`)}
            </Button>
          ))}
        </section>
        {faceControls?.enabled && !draft ? (
          <section aria-label={t('manualEdit.faceExtrude')} className='space-y-3 border-t border-border pt-3'>
            <p className='text-xs text-muted-foreground'>
              {t(faceControls.selected ? 'manualEdit.faceDragHelp' : 'manualEdit.faceSelectHelp')}
            </p>
            {faceControls.error ? (
              <p role='alert' className='text-xs text-destructive'>
                {faceControls.error}
              </p>
            ) : null}
            {faceControls.selected ? (
              <>
                <p className='text-xs'>
                  {t('manualEdit.faceSelected', {
                    name: faceControls.selected.name,
                    number: faceControls.selected.faceIndex + 1,
                  })}
                </p>
                <ManualNumberField
                  label={t('manualEdit.faceDistance')}
                  value={faceControls.distance}
                  onChange={faceControls.onDistanceChange}
                />
                <p className='text-xs text-muted-foreground'>{t('manualEdit.faceDistanceHelp')}</p>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    disabled={busy || !Number.isFinite(faceControls.distance) || faceControls.distance === 0}
                    onClick={faceControls.onApply}
                  >
                    {t('manualEdit.apply')}
                  </Button>
                  <Button size='sm' variant='outline' disabled={busy} onClick={faceControls.onCancel}>
                    {t('manualEdit.cancel')}
                  </Button>
                </div>
              </>
            ) : null}
          </section>
        ) : null}
        {draft ? (
          <section aria-label={t('manualEdit.draft')} className='space-y-3 border-t border-border pt-3'>
            <h3 className='text-sm font-medium'>
              {t(`manualEdit.${draft.operation.type}`)} · {t('manualEdit.draft')}
            </h3>
            {stale ? (
              <p role='alert' className='text-xs text-destructive'>
                {t('manualEdit.stale')}
              </p>
            ) : null}
            <fieldset disabled={busy} className='min-w-0'>
              <OperationFields
                key={draft.operation.id}
                operation={draft.operation}
                targets={choices}
                t={t}
                onChange={(operation) => {
                  setDraft({ ...draft, operation });
                }}
              />
            </fieldset>
            <div className='flex flex-wrap gap-1'>
              <Button
                size='sm'
                disabled={busy || stale}
                onClick={() => {
                  void saveDraft();
                }}
              >
                {t('manualEdit.apply')}
              </Button>
              <Button
                size='sm'
                variant='ghost'
                disabled={busy}
                onClick={() => {
                  setDraft(undefined);
                  setLocalError(undefined);
                }}
              >
                {t('manualEdit.cancel')}
              </Button>
            </div>
          </section>
        ) : null}
        <section aria-label={t('manualEdit.history')} className='space-y-2 border-t border-border pt-3'>
          <h3 className='text-xs font-medium'>{t('manualEdit.history')}</h3>
          {!isLoading && document?.operations.length === 0 ? (
            <p className='text-xs text-muted-foreground'>{t('manualEdit.empty')}</p>
          ) : null}
          <ol className='space-y-2'>
            {document?.operations.map((operation, index) => (
              <li key={operation.id} className='space-y-1 rounded-md border border-border p-2'>
                <label className='flex items-center gap-2 text-xs'>
                  <input
                    type='checkbox'
                    checked={operation.enabled !== false}
                    aria-label={t('manualEdit.enable', { number: index + 1 })}
                    disabled={busy || Boolean(draft)}
                    onChange={(event) => {
                      mutateHistory(
                        document.operations.map((entry) =>
                          entry.id === operation.id ? { ...entry, enabled: event.target.checked } : entry,
                        ),
                      );
                    }}
                  />
                  <span>
                    {index + 1}. {t(`manualEdit.${operation.type}`)} ·{' '}
                    {operation.type === 'extrude' && operation.mode === 'new' ? operation.name : operation.target?.name}
                  </span>
                </label>
                <div className='flex flex-wrap gap-1'>
                  <Button
                    size='xs'
                    variant='ghost'
                    disabled={busy || Boolean(draft)}
                    aria-label={t('manualEdit.edit', { number: index + 1 })}
                    onClick={() => {
                      startDraft(operation, false);
                    }}
                  >
                    {t('manualEdit.editShort')}
                  </Button>
                  <Button
                    size='xs'
                    variant='ghost'
                    disabled={busy || Boolean(draft)}
                    aria-label={t('manualEdit.remove', { number: index + 1 })}
                    onClick={() => {
                      mutateHistory(document.operations.filter((entry) => entry.id !== operation.id));
                    }}
                  >
                    {t('manualEdit.removeShort')}
                  </Button>
                  {([-1, 1] as const).map((direction) => (
                    <Button
                      key={direction}
                      size='xs'
                      variant='ghost'
                      aria-label={`${t(direction === -1 ? 'manualEdit.earlier' : 'manualEdit.later')} ${index + 1}`}
                      disabled={
                        busy ||
                        Boolean(draft) ||
                        index + direction < 0 ||
                        index + direction >= document.operations.length
                      }
                      onClick={() => {
                        const next = [...document.operations];
                        const other = next[index + direction]!;
                        next[index + direction] = operation;
                        next[index] = other;
                        mutateHistory(next);
                      }}
                    >
                      {direction === -1 ? '↑' : '↓'}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </aside>
  );
}
