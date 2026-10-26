import { randomUuid } from '@taucad/utils/id';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, MoreHorizontal, Redo2, Undo2, X } from 'lucide-react';
import { isManualProfileClosed, manualDocumentSchema } from '@taucad/smlib/manual-operations';
import type { ManualDocument, ManualOperation } from '@taucad/smlib/manual-operations';
import { Button } from '@taucad/ui/components/button';
import { Input } from '@taucad/ui/components/input';
import { ToggleGroup, ToggleGroupItem } from '@taucad/ui/components/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { useTranslation } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import type { DirectEditTool } from '@taucad/viewer/cad/direct-edit-tool';
import {
  ManualChoice,
  ManualNumberField,
  ManualVectorFields,
  manualPlanes,
} from '#routes/w.$workspace.$project/manual-edit-fields.js';
import { nextManualProfileName } from '#services/manual-profile-editor.js';
import { ManualProfileEditor } from '#routes/w.$workspace.$project/manual-edit-profile.js';

const toolTypes = ['extrude', 'translate', 'rotate', 'scale', 'mirror', 'hole', 'fillet', 'chamfer'] as const;
type Tool = (typeof toolTypes)[number] | 'sketch';
type Commit = (document: ManualDocument) => Promise<boolean>;
type Draft = { base: ManualDocument; operation: ManualOperation; commit: Commit; isNew: boolean };
type DirectMode = DirectEditTool['mode'];
const directModes = new Set<string>(['translate', 'rotate', 'scale', 'fillet', 'chamfer']);
const isDirectMode = (tool: Tool): tool is DirectMode => directModes.has(tool);

/** Direct body transforms and exact picked-edge operations, sharing the existing manual history. */
export type ManualDirectControls = Readonly<{
  mode?: DirectMode;
  available: boolean;
  selected?: Readonly<{ name: string; edgeCount: number }>;
  size: number;
  preview?: string;
  error?: string;
  onModeChange: (mode: DirectMode | undefined) => void;
  onSizeChange: (size: number) => void;
  onApply: () => void;
  onCancel: () => void;
}>;

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
    case 'sketch':
    case 'extrude': {
      const profile: Extract<ManualOperation, { type: 'extrude' }>['profile'] = {
        kind: 'polygon',
        plane: 'xy',
        origin: [0, 0, 0],
        points: [
          { id: randomUuid(), x: -10, y: -10 },
          { id: randomUuid(), x: 10, y: -10 },
          { id: randomUuid(), x: 10, y: 10 },
          { id: randomUuid(), x: -10, y: 10 },
        ],
      };
      if (type === 'sketch') {
        return { id, type, name, profile };
      }
      return {
        id,
        type,
        mode: 'new',
        name,
        distance: 10,
        profile,
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
  defaultName,
  onChange,
  t,
}: Readonly<{
  operation: ManualOperation;
  targets: readonly string[];
  defaultName: string;
  onChange: (operation: ManualOperation) => void;
  t: Translate;
}>): React.JSX.Element {
  const hasPickedEdges =
    (operation.type === 'fillet' || operation.type === 'chamfer') &&
    operation.edges.kind === 'indices' &&
    operation.edges.replayWitness !== undefined &&
    operation.edges.geometries !== undefined;
  const targetChoice = (
    <ManualChoice
      label={t('manualEdit.target')}
      value={operation.type === 'sketch' ? '' : (operation.target?.name ?? '')}
      choices={targets.map((name) => ({ value: name, label: name }))}
      onChange={(name) => {
        if (operation.type !== 'sketch') {
          onChange({ ...operation, target: { name } });
        }
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
            {hasPickedEdges ? null : (
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
            )}
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
      case 'sketch':
      case 'extrude': {
        const closed = isManualProfileClosed(operation.profile);
        return (
          <>
            <ManualProfileEditor
              profile={operation.profile}
              onChange={(profile) => {
                if (operation.type === 'extrude' && !isManualProfileClosed(profile)) {
                  onChange({
                    id: operation.id,
                    type: 'sketch',
                    enabled: operation.enabled,
                    name: operation.name ?? defaultName,
                    profile,
                  });
                } else {
                  onChange({ ...operation, profile });
                }
              }}
            />
            <ManualChoice
              label={t('manualEdit.mode')}
              value={operation.type === 'sketch' ? 'sketch' : operation.mode}
              choices={[
                { value: 'sketch', label: t('manualEdit.saveProfile') },
                ...(closed
                  ? [
                      { value: 'new', label: t('manualEdit.new') },
                      ...(targets.length > 0
                        ? [
                            { value: 'add', label: t('manualEdit.add') },
                            { value: 'cut', label: t('manualEdit.cut') },
                          ]
                        : []),
                    ]
                  : []),
              ]}
              onChange={(mode) => {
                const common = { id: operation.id, enabled: operation.enabled, profile: operation.profile };
                if (mode === 'sketch') {
                  onChange({ ...common, type: 'sketch', name: operation.name ?? defaultName });
                } else if (closed && (mode === 'new' || mode === 'add' || mode === 'cut')) {
                  onChange({
                    ...common,
                    type: 'extrude',
                    mode,
                    distance: operation.type === 'extrude' ? operation.distance : 10,
                    ...(mode === 'new'
                      ? { name: operation.name ?? defaultName }
                      : { target: { name: targets[0] ?? '' } }),
                  });
                }
              }}
            />
            {operation.type === 'sketch' || operation.mode === 'new' ? (
              <label className='block space-y-2 text-sm'>
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
            {operation.type === 'extrude' ? (
              <ManualNumberField
                label={t('manualEdit.depth')}
                value={operation.distance}
                onChange={(distance) => {
                  onChange({ ...operation, distance });
                }}
              />
            ) : null}
            <details className='group border-t border-border pt-3'>
              <summary className='text-sm font-medium'>
                {t('manualEdit.placement')}{' '}
                <span className='font-normal text-muted-foreground'>· {operation.profile.plane.toUpperCase()}</span>
              </summary>
              <div className='space-y-3 pt-3'>
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
              </div>
            </details>
          </>
        );
      }
    }
  };
  return (
    <div className='space-y-4'>
      {hasPickedEdges ? (
        <p className='text-xs text-muted-foreground'>
          {operation.target.name} · {t('manualEdit.guardedEdges')}
        </p>
      ) : operation.type === 'extrude' || operation.type === 'sketch' || operation.type === 'faceExtrude' ? null : (
        targetChoice
      )}
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
  directControls,
  onShowProfiles,
  onShowModel,
  onDraftLayoutChange,
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
  directControls?: ManualDirectControls;
  onShowProfiles?: () => void;
  onShowModel?: () => void;
  onDraftLayoutChange?: (layout: 'profile' | 'operation' | undefined) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>();
  const [view, setView] = useState<'tools' | 'history'>('tools');
  const [localError, setLocalError] = useState<string>();
  const [hasSaved, setHasSaved] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const busy = isLoading || isSaving || isCommitting;
  const stale = draft !== undefined && document !== draft.base;
  const choices = operationTargets(document, draft, targets);
  const edgeMode = directControls?.mode === 'fillet' || directControls?.mode === 'chamfer';
  const draftLayout = draft
    ? draft.operation.type === 'sketch' || draft.operation.type === 'extrude'
      ? 'profile'
      : 'operation'
    : undefined;
  useEffect(() => {
    onDraftLayoutChange?.(draftLayout);
  }, [draftLayout, onDraftLayoutChange]);
  const selection = faceControls?.enabled ? 'face' : edgeMode ? 'edge' : directControls?.mode ? 'body' : '';
  const visibleTools: readonly Tool[] = directControls
    ? selection === 'face'
      ? []
      : edgeMode
        ? ['fillet', 'chamfer']
        : ['translate', 'rotate', 'scale']
    : toolTypes;
  const startDraft = (operation: ManualOperation, isNew: boolean): void => {
    if (!document) {
      return;
    }
    faceControls?.onEnableChange(false);
    directControls?.onModeChange(undefined);
    setDraft({ base: document, operation, commit: onCommit, isNew });
    setView('tools');
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
  const activateTool = (type: Tool): void => {
    if (!document) {
      return;
    }
    if (directControls && isDirectMode(type)) {
      faceControls?.onEnableChange(false);
      directControls.onModeChange(type);
      return;
    }
    const name = nextManualProfileName({ document, targets, defaultName: t('manualEdit.newName') });
    startDraft(
      newOperation(type, directControls?.selected?.name ?? faceControls?.selected?.name ?? choices[0] ?? '', name),
      true,
    );
  };
  const selectedName = faceControls?.enabled
    ? faceControls.selected
      ? t('manualEdit.faceSelected', { name: faceControls.selected.name, number: faceControls.selected.faceIndex + 1 })
      : undefined
    : directControls?.selected?.name;
  return (
    <aside
      aria-label={t('manualEdit.title')}
      data-testid='manual-edit-panel'
      className='flex h-full min-h-0 w-full flex-col border-l border-border bg-background text-foreground'
      onKeyDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div className='flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3'>
        <h2 className='text-sm font-semibold'>{t('manualEdit.title')}</h2>
        <div className='flex items-center gap-1'>
          {(
            [
              { label: t('manualEdit.undo'), icon: Undo2, disabled: !canUndo, action: onUndo },
              { label: t('manualEdit.redo'), icon: Redo2, disabled: !canRedo, action: onRedo },
            ] as const
          ).map(({ label, icon: Icon, disabled, action }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  size='icon-sm'
                  variant='ghost'
                  aria-label={label}
                  disabled={disabled || busy || Boolean(draft)}
                  onClick={() => {
                    void action();
                  }}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
          {onClose ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size='icon-sm' variant='ghost' aria-label={t('manualEdit.close')} onClick={onClose}>
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('manualEdit.close')}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {draft ? null : (
        <div className='shrink-0 border-b border-border px-4 py-2'>
          <ToggleGroup
            type='single'
            value={view}
            aria-label={t('manualEdit.inspectorView')}
            onValueChange={(next) => {
              if (next === 'tools' || next === 'history') {
                setView(next);
              }
            }}
          >
            <ToggleGroupItem value='tools'>{t('manualEdit.tools')}</ToggleGroupItem>
            <ToggleGroupItem value='history'>
              {t('manualEdit.history')}{' '}
              <span className='text-muted-foreground tabular-nums'>{document?.operations.length ?? 0}</span>
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}
      <div className='min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4'>
        {isLoading ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('manualEdit.loading')}
          </p>
        ) : null}
        {(error ?? localError) ? (
          <p role='alert' className='text-sm text-destructive'>
            {localError ?? error}
          </p>
        ) : null}
        {hasSaved ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('manualEdit.saved')}
          </p>
        ) : null}
        {draft ? (
          <section aria-label={t('manualEdit.draft')} className='space-y-4'>
            <div className='flex items-baseline justify-between gap-2'>
              <h3 className='text-base font-medium'>{t(`manualEdit.${draft.operation.type}`)}</h3>
              <span className='text-xs text-muted-foreground'>{t('manualEdit.draft')}</span>
            </div>
            {stale ? (
              <p role='alert' className='text-sm text-destructive'>
                {t('manualEdit.stale')}
              </p>
            ) : null}
            <fieldset disabled={busy} className='min-w-0'>
              <OperationFields
                key={draft.operation.id}
                operation={draft.operation}
                targets={choices}
                defaultName={nextManualProfileName({
                  document: draft.base,
                  targets,
                  defaultName: t('manualEdit.newName'),
                  excludeId: draft.operation.id,
                })}
                t={t}
                onChange={(operation) => {
                  setDraft({ ...draft, operation });
                }}
              />
            </fieldset>
          </section>
        ) : view === 'history' ? (
          <section aria-label={t('manualEdit.history')} className='space-y-3'>
            <p className='text-xs text-muted-foreground'>{t('manualEdit.historyHelp')}</p>
            {!isLoading && document?.operations.length === 0 ? (
              <p className='text-sm text-muted-foreground'>{t('manualEdit.empty')}</p>
            ) : null}
            <ol className='divide-y divide-border'>
              {document?.operations.map((operation, index) => (
                <li key={operation.id} className='flex items-center gap-2 py-3'>
                  <input
                    type='checkbox'
                    className='size-4 shrink-0'
                    checked={operation.enabled !== false}
                    aria-label={t('manualEdit.enable', { number: index + 1 })}
                    disabled={busy}
                    onChange={(event) => {
                      mutateHistory(
                        document.operations.map((entry) =>
                          entry.id === operation.id ? { ...entry, enabled: event.target.checked } : entry,
                        ),
                      );
                    }}
                  />
                  <span className='w-4 shrink-0 text-xs text-muted-foreground tabular-nums'>{index + 1}</span>
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-medium'>{t(`manualEdit.${operation.type}`)}</p>
                    <p className='truncate text-xs text-muted-foreground'>
                      {operation.type === 'sketch' || (operation.type === 'extrude' && operation.mode === 'new')
                        ? operation.name
                        : operation.target?.name}
                    </p>
                  </div>
                  <Button
                    size='xs'
                    variant='ghost'
                    disabled={busy}
                    aria-label={t('manualEdit.edit', { number: index + 1 })}
                    onClick={() => {
                      startDraft(operation, false);
                    }}
                  >
                    {t('manualEdit.editShort')}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size='icon-sm'
                        variant='ghost'
                        disabled={busy}
                        aria-label={t('manualEdit.operationMenu', { number: index + 1 })}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      {([-1, 1] as const).map((direction) => (
                        <DropdownMenuItem
                          key={direction}
                          disabled={index + direction < 0 || index + direction >= document.operations.length}
                          onSelect={() => {
                            const next = [...document.operations];
                            const other = next[index + direction]!;
                            next[index + direction] = operation;
                            next[index] = other;
                            mutateHistory(next);
                          }}
                        >
                          {direction === -1 ? <ArrowUp /> : <ArrowDown />}
                          {t(direction === -1 ? 'manualEdit.earlier' : 'manualEdit.later')}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        aria-label={t('manualEdit.remove', { number: index + 1 })}
                        onSelect={() => {
                          mutateHistory(document.operations.filter((entry) => entry.id !== operation.id));
                        }}
                      >
                        {t('manualEdit.removeShort')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <>
            {directControls && faceControls ? (
              <section aria-label={t('manualEdit.selection')} className='space-y-3'>
                <ToggleGroup
                  type='single'
                  value={selection}
                  aria-label={t('manualEdit.selection')}
                  variant='outline'
                  disabled={busy || !document}
                  onValueChange={(filter) => {
                    if (!filter) {
                      return;
                    }
                    if (filter === 'face') {
                      directControls.onModeChange(undefined);
                      faceControls.onEnableChange(true);
                    } else {
                      faceControls.onEnableChange(false);
                      directControls.onModeChange(filter === 'edge' ? 'fillet' : 'translate');
                    }
                  }}
                >
                  {(['body', 'face', 'edge'] as const).map((filter) => (
                    <ToggleGroupItem key={filter} value={filter}>
                      {t(`manualEdit.${filter}Filter`)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className='space-y-1'>
                  <p className='text-sm font-medium break-words'>{selectedName ?? t('manualEdit.selectPiece')}</p>
                  {edgeMode && directControls.selected ? (
                    <p className='text-xs text-muted-foreground'>
                      {t(directControls.selected.edgeCount === 1 ? 'manualEdit.edgeCountOne' : 'manualEdit.edgeCount', {
                        count: directControls.selected.edgeCount,
                      })}
                    </p>
                  ) : null}
                </div>
                {(faceControls.enabled ? faceControls.available : directControls.available) ? null : (
                  <p role='status' className='text-xs text-muted-foreground'>
                    {t('manualEdit.selectionUnavailable')}
                  </p>
                )}
              </section>
            ) : (
              <p className='text-sm text-muted-foreground'>{t('manualEdit.intro')}</p>
            )}
            <section aria-label={t('manualEdit.tools')} className='space-y-2'>
              <div className='flex flex-wrap gap-2'>
                {faceControls && (faceControls.enabled || !directControls) ? (
                  <Button
                    size='sm'
                    variant='secondary'
                    aria-pressed={faceControls.enabled}
                    disabled={busy || !document || !faceControls.available}
                    onClick={() => {
                      directControls?.onModeChange(undefined);
                      faceControls.onEnableChange(true);
                    }}
                  >
                    {t('manualEdit.faceExtrude')}
                  </Button>
                ) : null}
                {visibleTools.map((type) => (
                  <Button
                    key={type}
                    size='sm'
                    variant={directControls?.mode === type ? 'secondary' : 'outline'}
                    aria-pressed={isDirectMode(type) && directControls ? directControls.mode === type : undefined}
                    disabled={busy || !document || (type !== 'extrude' && choices.length === 0)}
                    onClick={() => {
                      activateTool(type);
                    }}
                  >
                    {t(`manualEdit.${type}`)}
                  </Button>
                ))}
              </div>
              {directControls ? (
                <Button
                  size='sm'
                  variant='outline'
                  disabled={busy || !document}
                  onClick={() => {
                    activateTool('extrude');
                  }}
                >
                  {t('manualEdit.drawProfile')}
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size='sm' variant='ghost' disabled={busy || !document}>
                    {t('manualEdit.allTools')}
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='start'>
                  {(['sketch', ...toolTypes] as const)
                    .filter((type) => !visibleTools.includes(type) && type !== 'extrude')
                    .map((type) => (
                      <DropdownMenuItem
                        key={type}
                        disabled={type !== 'sketch' && type !== 'extrude' && choices.length === 0}
                        onSelect={() => {
                          activateTool(type);
                        }}
                      >
                        {t(`manualEdit.${type}`)}
                      </DropdownMenuItem>
                    ))}
                  {faceControls && !faceControls.enabled ? (
                    <DropdownMenuItem
                      disabled={!faceControls.available}
                      onSelect={() => {
                        directControls?.onModeChange(undefined);
                        faceControls.onEnableChange(true);
                      }}
                    >
                      {t('manualEdit.faceExtrude')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </section>
            {directControls?.mode ? (
              <section aria-label={t('manualEdit.directTool')} className='space-y-3 border-t border-border pt-4'>
                <p className='text-sm text-muted-foreground'>
                  {t(
                    directControls.available
                      ? edgeMode
                        ? 'manualEdit.edgeSelectHelp'
                        : directControls.selected
                          ? 'manualEdit.directDragHelp'
                          : 'manualEdit.directSelectHelp'
                      : 'manualEdit.directUnavailable',
                  )}
                </p>
                {directControls.error ? (
                  <p role='alert' className='text-sm text-destructive'>
                    {directControls.error}
                  </p>
                ) : null}
                {directControls.preview ? (
                  <p role='status' className='text-sm tabular-nums'>
                    {directControls.preview}
                  </p>
                ) : null}
                {edgeMode ? (
                  <ManualNumberField
                    label={t(directControls.mode === 'fillet' ? 'manualEdit.edgeRadius' : 'manualEdit.size')}
                    value={directControls.size}
                    onChange={directControls.onSizeChange}
                    min={0.001}
                  />
                ) : null}
                <div className='flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={busy || choices.length === 0}
                    onClick={() => {
                      const type = directControls.mode;
                      if (type) {
                        startDraft(newOperation(type, directControls.selected?.name ?? choices[0] ?? '', ''), true);
                      }
                    }}
                  >
                    {t('manualEdit.numericDraft')}
                  </Button>
                  <Button size='sm' variant='ghost' disabled={busy} onClick={directControls.onCancel}>
                    {t('manualEdit.clearSelection')}
                  </Button>
                </div>
              </section>
            ) : null}
            {faceControls?.enabled ? (
              <section aria-label={t('manualEdit.faceExtrude')} className='space-y-3 border-t border-border pt-4'>
                <p className='text-sm text-muted-foreground'>
                  {t(faceControls.selected ? 'manualEdit.faceDragHelp' : 'manualEdit.faceSelectHelp')}
                </p>
                {faceControls.error ? (
                  <p role='alert' className='text-sm text-destructive'>
                    {faceControls.error}
                  </p>
                ) : null}
                {faceControls.selected ? (
                  <>
                    <ManualNumberField
                      label={t('manualEdit.faceDistance')}
                      value={faceControls.distance}
                      onChange={faceControls.onDistanceChange}
                    />
                    <p className='text-xs text-muted-foreground'>{t('manualEdit.faceDistanceHelp')}</p>
                  </>
                ) : null}
              </section>
            ) : null}
            {choices.length === 0 ? <p className='text-xs text-muted-foreground'>{t('manualEdit.noTargets')}</p> : null}
            {onShowProfiles !== undefined || onShowModel !== undefined ? (
              <div className='flex flex-wrap gap-2 border-t border-border pt-4'>
                {onShowProfiles ? (
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={busy}
                    onClick={() => {
                      onShowProfiles();
                    }}
                  >
                    {t('manualEdit.showProfiles')}
                  </Button>
                ) : null}
                {onShowModel ? (
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={busy}
                    onClick={() => {
                      onShowModel();
                    }}
                  >
                    {t('manualEdit.showModel')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      {draft ? (
        <div className='flex shrink-0 items-center justify-end gap-2 border-t border-border bg-background px-4 py-3'>
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
          <Button
            size='sm'
            disabled={busy || stale}
            aria-busy={isCommitting}
            onClick={() => {
              void saveDraft();
            }}
          >
            {t(isCommitting ? 'manualEdit.saving' : 'manualEdit.apply')}
          </Button>
        </div>
      ) : view === 'tools' && edgeMode ? (
        <div className='flex shrink-0 justify-end border-t border-border px-4 py-3'>
          <Button
            size='sm'
            disabled={
              busy ||
              !directControls.available ||
              !directControls.selected?.edgeCount ||
              !Number.isFinite(directControls.size) ||
              directControls.size <= 0
            }
            onClick={directControls.onApply}
          >
            {t('manualEdit.apply')}
          </Button>
        </div>
      ) : view === 'tools' && faceControls?.enabled && faceControls.selected ? (
        <div className='flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3'>
          <Button size='sm' variant='ghost' disabled={busy} onClick={faceControls.onCancel}>
            {t('manualEdit.cancel')}
          </Button>
          <Button
            size='sm'
            disabled={busy || !Number.isFinite(faceControls.distance) || faceControls.distance === 0}
            onClick={faceControls.onApply}
          >
            {t('manualEdit.apply')}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}
