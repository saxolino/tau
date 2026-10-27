import { randomUuid } from '@taucad/utils/id';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpFromLine,
  Box,
  ChevronRight,
  CircleDot,
  FlipHorizontal2,
  MoreHorizontal,
  Move,
  PenTool,
  Redo2,
  RotateCw,
  Ruler,
  Scaling,
  Slash,
  Spline,
  Square,
  SquareRoundCorner,
  Undo2,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isManualProfileClosed, manualDocumentSchema } from '@taucad/smlib/manual-operations';
import type { ManualDocument, ManualOperation } from '@taucad/smlib/manual-operations';
import { Button } from '@taucad/ui/components/button';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { Input } from '@taucad/ui/components/input';
import { Switch } from '@taucad/ui/components/switch';
import { ToggleGroup, ToggleGroupItem } from '@taucad/ui/components/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { cn } from '@taucad/ui/utils/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import type { DirectEditTool } from '@taucad/viewer/cad/direct-edit-tool';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { describeManualOperation } from '#lib/inspector-selection.js';
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
  selected?: Readonly<{ name: string; edgeCount: number; componentId?: string }>;
  size: number;
  preview?: string;
  /** A handle is being dragged: the quota follows the pointer. */
  isDragging?: boolean;
  error?: string;
  onModeChange: (mode: DirectMode | undefined) => void;
  onSizeChange: (size: number) => void;
  onApply: () => void;
  onCancel: () => void;
  /** Put the body handles on a piece chosen elsewhere (the measures list, a chip), or drop them. */
  onSelectPiece?: (componentId: string | undefined) => void;
}>;

/** Shared controls for picking a native planar face and editing its signed extrusion, or drilling a hole from it. */
export type ManualFaceControls = Readonly<{
  enabled: boolean;
  available: boolean;
  selected?: Readonly<{
    name: string;
    faceIndex: number;
    componentId?: string;
    normal?: readonly [number, number, number];
  }>;
  /** The held preview distance, in millimetres (0: nothing held). */
  distance: number;
  isDragging?: boolean;
  action?: 'extrude' | 'hole';
  hole?: Readonly<{ diameter: number; depth: number; through: boolean; extent?: number }>;
  error?: string;
  onEnableChange: (enabled: boolean) => void;
  onDistanceChange: (distance: number) => void;
  onActionChange?: (action: 'extrude' | 'hole') => void;
  onHoleChange?: (hole: Partial<Readonly<{ diameter: number; depth: number; through: boolean }>>) => void;
  onApply: () => void;
  onCancel: () => void;
  /** Drop the face selection altogether. */
  onClear?: () => void;
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

type SelectionFilter = 'body' | 'face' | 'edge';

const filterIcons: Record<SelectionFilter, LucideIcon> = { body: Box, face: Square, edge: Slash };
const toolIcons: Record<Tool, LucideIcon> = {
  translate: Move,
  rotate: RotateCw,
  scale: Scaling,
  mirror: FlipHorizontal2,
  hole: CircleDot,
  fillet: SquareRoundCorner,
  chamfer: Slash,
  extrude: PenTool,
  sketch: Spline,
};

/** One tool in the inspector's toolbar: the main one is wide and labelled, the others are glyphs with a tooltip. */
function ToolButton({
  icon: Icon,
  label,
  isPressed,
  isPrimary = false,
  disabled,
  onClick,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  isPressed?: boolean;
  isPrimary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}>): React.JSX.Element {
  const button = (
    <Button
      size={isPrimary ? 'sm' : 'icon-sm'}
      variant='ghost'
      aria-label={label}
      aria-pressed={isPressed}
      disabled={disabled}
      className={cn(
        'border border-transparent',
        isPrimary && 'min-w-0 flex-1 justify-start gap-2',
        // Titanio marks the tool in use; it is never a filled action (Sinopia red is Applica's).
        isPressed && 'border-titanium bg-titanium/15 text-foreground hover:bg-titanium/25',
      )}
      onClick={onClick}
    >
      <Icon aria-hidden className='size-4' />
      {isPrimary ? <span className='truncate'>{label}</span> : null}
    </Button>
  );
  return isPrimary ? (
    button
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A signed distance as the inspector writes it: «+2,50 mm», «−1,00 mm». */
const signedMillimetres = (value: number, language: Parameters<typeof formatNumber>[1]): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} mm`;

const isTextField = (target: EventTarget): boolean =>
  target instanceof HTMLElement && target.closest('input, textarea, [contenteditable=true]') !== null;

/**
 * The inspector's tools for what is selected: the selection filter (piece, face, edges), the main tool of that
 * selection and its secondary tools, the numbers of the operation being previewed with one Applica (Invio) and one
 * Annulla (Esc), and the history of manual operations in words. Drafts keep their exact authoring snapshot until saved
 * or discarded.
 */
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
  historySlot,
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
  /** Where the history goes, when the inspector keeps it at its foot; inline otherwise. */
  historySlot?: HTMLElement;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  const [draft, setDraft] = useState<Draft>();
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
  const selection: SelectionFilter | '' = faceControls?.enabled
    ? 'face'
    : edgeMode
      ? 'edge'
      : directControls?.mode
        ? 'body'
        : '';
  const facePending =
    selection === 'face' &&
    faceControls?.selected !== undefined &&
    (faceControls.action === 'hole' || faceControls.distance !== 0);
  const edgePending =
    selection === 'edge' &&
    (directControls?.selected?.edgeCount ?? 0) > 0 &&
    Number.isFinite(directControls?.size) &&
    (directControls?.size ?? 0) > 0;
  const pending: 'draft' | 'face' | 'edge' | undefined = draft
    ? 'draft'
    : facePending
      ? 'face'
      : edgePending
        ? 'edge'
        : undefined;
  const startDraft = (operation: ManualOperation, isNew: boolean): void => {
    if (!document) {
      return;
    }
    faceControls?.onEnableChange(false);
    directControls?.onModeChange(undefined);
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
      resumeTools();
    }
  };
  /** A draft over, the piece tools come back: the inspector is never left without a selection tool. */
  const resumeTools = (): void => {
    if (directControls && !directControls.mode && !faceControls?.enabled) {
      directControls.onModeChange('translate');
    }
  };
  const discardDraft = (): void => {
    setDraft(undefined);
    setLocalError(undefined);
    resumeTools();
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
      setDraft(undefined);
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
  const chooseFilter = (filter: SelectionFilter): void => {
    // A filter is always reachable: choosing one ends a numeric draft instead of hiding the choice.
    setDraft(undefined);
    setLocalError(undefined);
    if (filter === 'face') {
      directControls?.onModeChange(undefined);
      faceControls?.onEnableChange(true);
    } else {
      faceControls?.onEnableChange(false);
      directControls?.onModeChange(filter === 'edge' ? 'fillet' : 'translate');
    }
  };
  const applyPending = (): void => {
    if (busy) {
      return;
    }
    switch (pending) {
      case 'draft': {
        void saveDraft();
        break;
      }
      case 'face': {
        faceControls?.onApply();
        break;
      }
      case 'edge': {
        directControls?.onApply();
        break;
      }
      case undefined: {
        break;
      }
    }
  };
  const cancelPending = (): void => {
    if (pending === 'draft') {
      discardDraft();
    } else if (pending === 'face' || selection === 'face') {
      faceControls?.onCancel();
    } else if (selection === 'edge' || selection === 'body') {
      directControls?.onCancel();
    }
  };
  /*
   * Invio and Esc confirm and discard a previewed operation (a face, a hole, a fillet or chamfer), from the model too,
   * not only from inside the inspector. A draft keeps its own buttons: its fields and profile points use those keys.
   */
  const isPreviewPending = pending === 'face' || pending === 'edge';
  const keys = useRef({ applyPending, cancelPending, isPreviewPending, canCancel: false });
  const canCancel =
    draft === undefined &&
    (isPreviewPending || faceControls?.selected !== undefined || directControls?.selected !== undefined);
  useLayoutEffect(() => {
    keys.current = { applyPending, cancelPending, isPreviewPending, canCancel };
  });
  useKeybinding(
    { key: 'Enter' },
    () => {
      keys.current.applyPending();
    },
    {
      enabled: () => keys.current.isPreviewPending,
      ignoreInputs: true,
      scope: 'global',
      priority: 1,
    },
  );
  useKeybinding(
    { key: 'Escape' },
    () => {
      keys.current.cancelPending();
    },
    {
      enabled: () => keys.current.canCancel,
      ignoreInputs: true,
      scope: 'global',
      priority: 1,
    },
  );
  const scheduleApply = useCallback(() => {
    // A typed value commits on Enter first; the operation applies on the next frame with that value.
    requestAnimationFrame(() => {
      keys.current.applyPending();
    });
  }, []);

  // With nothing editable on the model yet, the main tool creates: a profile to extrude into a first piece.
  const hasPieces = choices.length > 0;
  const primary: Tool | 'faceExtrude' | undefined =
    selection === 'face'
      ? 'faceExtrude'
      : selection === 'edge'
        ? 'fillet'
        : selection === 'body' && hasPieces
          ? 'translate'
          : undefined;
  const secondary: ReadonlyArray<Tool | 'holeHere'> =
    selection === 'face'
      ? ['holeHere']
      : selection === 'edge'
        ? ['chamfer']
        : selection === 'body' && hasPieces
          ? ['rotate', 'scale']
          : [];
  const moreTools: readonly Tool[] = (
    ['sketch', 'extrude', 'mirror', 'hole', 'translate', 'rotate', 'scale', 'fillet', 'chamfer'] as const
  )
    // Without a selection tool the main button is «Disegna profilo» (extrude), so the menu does not repeat it.
    .filter((type) => type !== (primary ?? 'extrude') && !secondary.includes(type));
  const directBusy = busy || !document;
  const help = ((): string | undefined => {
    if (draft) {
      return undefined;
    }
    if (selection === 'face') {
      if (!faceControls?.selected) {
        return t('manualEdit.faceSelectHelp');
      }
      return faceControls.action === 'hole' ? t('manualEdit.holeHelp') : t('manualEdit.facePreviewHelp');
    }
    if (selection === 'edge') {
      return directControls?.selected?.edgeCount ? t('manualEdit.edgePreviewHelp') : t('manualEdit.edgeSelectHelp');
    }
    if (selection === 'body' && hasPieces) {
      if (!directControls?.available) {
        return t('manualEdit.directUnavailable');
      }
      return directControls.selected ? t('manualEdit.bodyHelp') : t('manualEdit.selectPieceFirst');
    }
    return t('manualEdit.intro');
  })();
  const faceHole = faceControls?.hole;
  const history = (
    <details className='group/history border-t border-border'>
      <summary className='flex cursor-action list-none items-center gap-2 px-4 py-2.5 focus-visible:focus-outline [&::-webkit-details-marker]:hidden'>
        <ChevronRight
          aria-hidden
          className='size-3 text-muted-foreground transition-transform group-open/history:rotate-90'
        />
        <Eyebrow>{t('manualEdit.historyCount', { count: document?.operations.length ?? 0 })}</Eyebrow>
      </summary>
      <section aria-label={t('manualEdit.history')} className='space-y-2 px-2 pb-3'>
        <p className='px-2 text-xs text-muted-foreground'>{t('manualEdit.historyHelp')}</p>
        {!isLoading && document?.operations.length === 0 ? (
          <p className='px-2 text-sm text-muted-foreground'>{t('manualEdit.empty')}</p>
        ) : null}
        <ol className='divide-y divide-border'>
          {document?.operations.map((operation, index) => (
            <li key={operation.id} className='flex items-center gap-2 px-2 py-2'>
              <input
                type='checkbox'
                className='size-4 shrink-0 accent-(--titanium-foreground)'
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
              <p
                className={cn(
                  'min-w-0 flex-1 text-xs leading-snug wrap-break-word',
                  operation.enabled === false && 'text-muted-foreground line-through',
                )}
              >
                {describeManualOperation({ ...operation, enabled: true }, t, language)}
              </p>
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
                    size='icon-xs'
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
    </details>
  );
  return (
    <section
      aria-label={t('manualEdit.title')}
      data-testid='manual-edit-panel'
      className='flex min-w-0 flex-col text-foreground'
      onKeyDownCapture={(event) => {
        // Before the field commits its value on Enter (it may stop the event), so the apply sees that value.
        if (event.key === 'Enter' && isPreviewPending && isTextField(event.target)) {
          scheduleApply();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !isTextField(event.target) && canCancel) {
          event.preventDefault();
          cancelPending();
        }
        // Typing in the inspector never reaches the viewer's single-key shortcuts.
        event.stopPropagation();
      }}
    >
      <div className='flex items-center justify-between gap-2 px-4 pt-3'>
        <Eyebrow>{t('manualEdit.selectWhat')}</Eyebrow>
        <div className='flex items-center gap-0.5'>
          {(
            [
              { label: t('manualEdit.undo'), icon: Undo2, disabled: !canUndo, action: onUndo },
              { label: t('manualEdit.redo'), icon: Redo2, disabled: !canRedo, action: onRedo },
            ] as const
          ).map(({ label, icon: Icon, disabled, action }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <Button
                  size='icon-xs'
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
                <Button size='icon-xs' variant='ghost' aria-label={t('manualEdit.close')} onClick={onClose}>
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('manualEdit.close')}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
      {directControls && faceControls ? (
        <div className='px-4 pt-1.5'>
          <ToggleGroup
            type='single'
            value={selection}
            aria-label={t('manualEdit.selection')}
            variant='outline'
            size='sm'
            className='w-full'
            disabled={busy || !document}
            onValueChange={(filter) => {
              if (filter === 'body' || filter === 'face' || filter === 'edge') {
                chooseFilter(filter);
              }
            }}
          >
            {(['body', 'face', 'edge'] as const).map((filter) => {
              const Icon = filterIcons[filter];
              return (
                <ToggleGroupItem
                  key={filter}
                  value={filter}
                  className='flex-1 gap-1.5 data-[state=on]:border-titanium data-[state=on]:bg-titanium/15'
                >
                  <Icon aria-hidden className='size-3.5' />
                  {t(`manualEdit.${filter}Filter`)}
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>
      ) : null}
      <div className='px-4 pt-4'>
        <Eyebrow>{t('manualEdit.toolsFor')}</Eyebrow>
        <div role='toolbar' aria-label={t('manualEdit.tools')} className='mt-1.5 flex items-center gap-1'>
          {primary === 'faceExtrude' ? (
            <ToolButton
              isPrimary
              icon={ArrowUpFromLine}
              label={t('manualEdit.faceExtrude')}
              isPressed={!draft && faceControls?.action !== 'hole'}
              disabled={busy || !document || !faceControls?.available}
              onClick={() => {
                setDraft(undefined);
                faceControls?.onActionChange?.('extrude');
              }}
            />
          ) : primary ? (
            <ToolButton
              isPrimary
              icon={toolIcons[primary]}
              label={t(`manualEdit.${primary}`)}
              isPressed={!draft && directControls?.mode === primary}
              disabled={directBusy || choices.length === 0}
              onClick={() => {
                activateTool(primary);
              }}
            />
          ) : (
            <ToolButton
              isPrimary
              icon={PenTool}
              label={t('manualEdit.drawProfile')}
              isPressed={draft?.operation.type === 'extrude'}
              disabled={directBusy}
              onClick={() => {
                activateTool('extrude');
              }}
            />
          )}
          {secondary.map((type) =>
            type === 'holeHere' ? (
              <ToolButton
                key={type}
                icon={CircleDot}
                label={t('manualEdit.holeHere')}
                isPressed={!draft && faceControls?.action === 'hole'}
                disabled={busy || !faceControls?.selected}
                onClick={() => {
                  setDraft(undefined);
                  faceControls?.onActionChange?.('hole');
                }}
              />
            ) : (
              <ToolButton
                key={type}
                icon={toolIcons[type]}
                label={t(`manualEdit.${type}`)}
                isPressed={!draft && directControls?.mode === type}
                disabled={directBusy || choices.length === 0}
                onClick={() => {
                  activateTool(type);
                }}
              />
            ),
          )}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button size='icon-sm' variant='ghost' aria-label={t('manualEdit.allTools')} disabled={directBusy}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('manualEdit.allTools')}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align='end'>
              {moreTools.map((type) => {
                const Icon = toolIcons[type];
                return (
                  <DropdownMenuItem
                    key={type}
                    disabled={type !== 'sketch' && type !== 'extrude' && choices.length === 0}
                    onSelect={() => {
                      activateTool(type);
                    }}
                  >
                    <Icon aria-hidden />
                    {type === 'extrude' ? t('manualEdit.drawProfile') : t(`manualEdit.${type}`)}
                  </DropdownMenuItem>
                );
              })}
              {directControls?.mode ? (
                <DropdownMenuItem
                  disabled={choices.length === 0}
                  onSelect={() => {
                    const type = directControls.mode;
                    if (type) {
                      startDraft(newOperation(type, directControls.selected?.name ?? choices[0] ?? '', ''), true);
                    }
                  }}
                >
                  <Ruler aria-hidden />
                  {t('manualEdit.numericDraft')}
                </DropdownMenuItem>
              ) : null}
              {/* Switching the view mid-draft would hide what is being drawn: the view actions wait for it. */}
              {!draft && (onShowProfiles !== undefined || onShowModel !== undefined) ? <DropdownMenuSeparator /> : null}
              {onShowProfiles && !draft ? (
                <DropdownMenuItem
                  onSelect={() => {
                    onShowProfiles();
                  }}
                >
                  {t('manualEdit.showProfiles')}
                </DropdownMenuItem>
              ) : null}
              {onShowModel && !draft ? (
                <DropdownMenuItem
                  onSelect={() => {
                    onShowModel();
                  }}
                >
                  {t('manualEdit.showModel')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className='min-w-0 space-y-3 px-4 py-3'>
        {help ? <p className='text-xs leading-relaxed text-muted-foreground'>{help}</p> : null}
        {isLoading ? (
          <p role='status' className='text-sm text-muted-foreground'>
            {t('manualEdit.loading')}
          </p>
        ) : null}
        {(error ?? localError ?? directControls?.error ?? faceControls?.error) ? (
          <p role='alert' className='text-sm text-destructive'>
            {localError ?? error ?? (selection === 'face' ? faceControls?.error : directControls?.error)}
          </p>
        ) : null}
        {hasSaved && !draft ? (
          <p role='status' className='text-xs text-muted-foreground'>
            {t('manualEdit.saved')}
          </p>
        ) : null}
        {selection === 'body' && !draft && directControls?.preview ? (
          <p role='status' className='font-mono text-xs tabular-nums'>
            {directControls.preview}
          </p>
        ) : null}
        {draft ? (
          <section aria-label={t('manualEdit.draft')} className='space-y-4'>
            <div className='flex items-baseline justify-between gap-2'>
              <h3 className='text-sm font-medium'>{t(`manualEdit.${draft.operation.type}`)}</h3>
              <Eyebrow>{t('manualEdit.draft')}</Eyebrow>
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
        ) : selection === 'face' && faceControls?.selected ? (
          faceControls.action === 'hole' && faceHole ? (
            <section aria-label={t('manualEdit.holeHere')} className='space-y-2'>
              <ManualNumberField
                label={t('manualEdit.diameter')}
                value={faceHole.diameter}
                min={0.1}
                onChange={(diameter) => {
                  faceControls.onHoleChange?.({ diameter });
                }}
              />
              <label className='flex items-center justify-between gap-2 text-sm text-muted-foreground'>
                {t('manualEdit.holeThrough')}
                <Switch
                  checked={faceHole.through}
                  disabled={faceHole.extent === undefined}
                  onCheckedChange={(through) => {
                    faceControls.onHoleChange?.({ through });
                  }}
                />
              </label>
              {faceHole.through && faceHole.extent !== undefined ? null : (
                <ManualNumberField
                  label={t('manualEdit.depth')}
                  value={faceHole.depth}
                  min={0.1}
                  onChange={(depth) => {
                    faceControls.onHoleChange?.({ depth, through: false });
                  }}
                />
              )}
            </section>
          ) : (
            <section aria-label={t('manualEdit.faceExtrude')} className='space-y-2'>
              <ManualNumberField
                label={t('manualEdit.faceDistance')}
                value={faceControls.distance}
                onChange={faceControls.onDistanceChange}
              />
              <p className='text-xs text-muted-foreground'>{t('manualEdit.faceDistanceHelp')}</p>
            </section>
          )
        ) : selection === 'edge' && directControls?.selected?.edgeCount ? (
          <section aria-label={t(`manualEdit.${directControls.mode ?? 'fillet'}`)} className='space-y-2'>
            <p className='text-xs text-muted-foreground'>
              {t(directControls.selected.edgeCount === 1 ? 'manualEdit.edgeCountOne' : 'manualEdit.edgeCount', {
                count: directControls.selected.edgeCount,
              })}
            </p>
            <ManualNumberField
              label={t(directControls.mode === 'chamfer' ? 'manualEdit.size' : 'manualEdit.edgeRadius')}
              value={directControls.size}
              onChange={directControls.onSizeChange}
              min={0.001}
            />
          </section>
        ) : null}
      </div>
      {pending ? (
        <div className='sticky bottom-0 z-10 flex items-center justify-end gap-1.5 border-t border-border bg-sidebar px-4 py-2'>
          {pending === 'face' && faceControls?.action !== 'hole' ? (
            <span className='mr-auto min-w-0 truncate font-mono text-xs text-titanium-foreground tabular-nums'>
              {signedMillimetres(faceControls?.distance ?? 0, language)}
            </span>
          ) : null}
          <Button size='sm' variant='ghost' disabled={busy} aria-keyshortcuts='Escape' onClick={cancelPending}>
            {pending === 'draft' ? t('manualEdit.cancel') : t('manualEdit.discardShort')}
            <KeyShortcut variant='ghost'>Esc</KeyShortcut>
          </Button>
          <Button
            size='sm'
            disabled={busy || (pending === 'draft' && stale)}
            aria-busy={isCommitting}
            aria-keyshortcuts='Enter'
            onClick={applyPending}
          >
            {t(isCommitting ? 'manualEdit.saving' : pending === 'draft' ? 'manualEdit.apply' : 'manualEdit.applyShort')}
            <KeyShortcut variant='tooltip'>↵</KeyShortcut>
          </Button>
        </div>
      ) : null}
      {historySlot ? createPortal(history, historySlot) : history}
    </section>
  );
}
