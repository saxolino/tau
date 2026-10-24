import { memo } from 'react';
import { Box, Eye, EyeOff, Target } from 'lucide-react';
import type { GeometryComponentManifest, GeometryComponentNode } from '@taucad/types';
import { ContextMenu, ContextMenuTrigger } from '@taucad/ui/components/context-menu';
import { HighlightText } from '@taucad/ui/components/highlight-text';
import { nestedActionVariants } from '@taucad/ui/components/nested-action.variants';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { cn } from '@taucad/ui/utils/cn';
import { MaterialSwatch } from '@taucad/viewer/cad/material-swatch';
import { PartPreviewFrame } from '@taucad/viewer/cad/part-preview-image';
import type { PartThumbnailState } from '@taucad/viewer/cad/part-thumbnail-state';
import type { GraphicsRef } from '#host/workbench-host.jsx';
import { useWorkbenchPanesHost } from '#host/workbench-host.jsx';
import { useModelPaneLabels } from '#model/model-labels.js';
import type { ModelPaneLabels } from '#model/model-source.js';
import { isPreviewablePart } from '#model/visible-components.js';

/**
 * The left inset of a component row at a tree depth.
 *
 * @internal
 * @returns The inset in pixels.
 */
export function getComponentRowPaddingLeft({
  depth,
  rootDepth,
}: {
  readonly depth: number;
  readonly rootDepth: number;
}): number {
  return 8 + Math.max(0, depth - rootDepth - 1) * 12;
}

function getVisibilityAction({
  isHidden,
  nodeName,
  unitId,
  componentId,
  labels,
}: {
  readonly isHidden: boolean;
  readonly nodeName: string;
  readonly unitId: string;
  readonly componentId: string;
  readonly labels: ModelPaneLabels;
}) {
  if (isHidden) {
    return {
      Icon: EyeOff,
      ariaLabel: labels.show(nodeName),
      event: { type: 'showModelComponent', unitId, componentId, source: 'explorer' } as const,
      tooltip: labels.showPart,
    };
  }

  return {
    Icon: Eye,
    ariaLabel: labels.hide(nodeName),
    event: { type: 'hideModelComponent', unitId, componentId, source: 'explorer' } as const,
    tooltip: labels.hidePart,
  };
}

function getIsolationAction({
  isIsolated,
  nodeName,
  unitId,
  componentId,
  labels,
}: {
  readonly isIsolated: boolean;
  readonly nodeName: string;
  readonly unitId: string;
  readonly componentId: string;
  readonly labels: ModelPaneLabels;
}) {
  if (isIsolated) {
    return {
      ariaLabel: labels.removeIsolationFor(nodeName),
      className: 'bg-muted-foreground/15 text-foreground',
      event: { type: 'clearModelComponentIsolation', unitId, source: 'explorer' } as const,
      pressed: true,
      tooltip: labels.removeIsolation,
    };
  }

  return {
    ariaLabel: labels.isolate(nodeName),
    className: undefined,
    event: { type: 'isolateModelComponent', unitId, componentId, source: 'explorer' } as const,
    pressed: false,
    tooltip: labels.isolatePart,
  };
}

/**
 * A row's actions: inline on a compact row; stacked beside a preview row's 80 px thumbnail, so its name keeps the
 * width to read in full.
 *
 * @returns The actions, wrapped in a column on a preview row.
 */
function RowActions({
  isStacked,
  children,
}: {
  readonly isStacked: boolean;
  readonly children: React.ReactNode;
}): React.ReactNode {
  return isStacked ? (
    <div data-slot='model-row-actions' className='flex shrink-0 flex-col items-center gap-0.5'>
      {children}
    </div>
  ) : (
    children
  );
}

/**
 * One component row of the Model tree: preview, name, visibility, isolation and the host's component menu.
 *
 * @internal
 */
// oxlint-disable-next-line complexity -- one row's lit, hover, preview and menu states, moved from the app as is
export const ComponentRow = memo(function ComponentRow({
  manifest,
  node,
  query = '',
  graphicsRef,
  unitId,
  rootDepth,
  hoveredComponentId,
  isSelected,
  isHidden,
  isIsolated,
  isFocused,
  hasHiddenComponents = false,
  hasOpacityOverrides = false,
  opacity,
  activeRowId,
  onRowFocus,
  preview,
  onRetryPreview,
  onPreviewDecodeError,
  onPreviewDecoded,
}: {
  readonly manifest: GeometryComponentManifest;
  readonly node: GeometryComponentNode;
  readonly query?: string;
  readonly graphicsRef: GraphicsRef;
  readonly unitId: string;
  readonly rootDepth: number;
  readonly hoveredComponentId: string | undefined;
  readonly isSelected: boolean;
  readonly isHidden: boolean;
  readonly isIsolated: boolean;
  readonly isFocused: boolean;
  readonly hasHiddenComponents?: boolean;
  readonly hasOpacityOverrides?: boolean;
  readonly opacity: number;
  readonly activeRowId?: string;
  readonly onRowFocus?: (id: string) => void;
  readonly preview?: PartThumbnailState;
  readonly onRetryPreview?: (id: string) => void;
  readonly onPreviewDecodeError?: (id: string, bytes: Uint8Array<ArrayBuffer>) => void;
  readonly onPreviewDecoded?: (id: string, bytes: Uint8Array<ArrayBuffer>) => void;
}): React.JSX.Element {
  const source = useWorkbenchPanesHost().model;
  const labels = useModelPaneLabels();
  /* The name the host shows; the filter matches it and the manifest's name alike. */
  const name = source?.componentName?.(node) ?? node.name;
  const isHovered = hoveredComponentId === node.id;
  const normalizedQuery = query.trim().toLowerCase();
  const materialMatchName =
    normalizedQuery &&
    !node.name.toLowerCase().includes(normalizedQuery) &&
    !name.toLowerCase().includes(normalizedQuery)
      ? node.appearance?.materials?.find(
          (material) => typeof material.name === 'string' && material.name.toLowerCase().includes(normalizedQuery),
        )?.name
      : undefined;
  const visibilityAction = getVisibilityAction({ isHidden, nodeName: name, unitId, componentId: node.id, labels });
  const isolationAction = getIsolationAction({ isIsolated, nodeName: name, unitId, componentId: node.id, labels });
  const VisibilityIcon = visibilityAction.Icon;
  /* The sidebar row's action: 24 px with the nested-action tone (nested-action surfaces R5). */
  const actionButtonClassName = nestedActionVariants({
    className: cn(
      'flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0',
      'focus-visible:bg-nested-action-hover focus-visible:text-foreground focus-visible:opacity-100 focus-visible:focus-outline',
      'group-hover/part:opacity-100 group-focus-within/part:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100',
      (isHovered || isIsolated) && 'opacity-100',
    ),
  });
  const guideCount = Math.max(0, node.depth - rootDepth - 1);
  const openPartGallery = source?.openPartGallery;
  const actions = source?.componentActions;
  /* Without a thumbnail renderer a part row stays compact. */
  const isPreviewRow = source?.useThumbnails !== undefined && isPreviewablePart(node);
  const swatch = node.appearance?.materials?.length ? (
    <MaterialSwatch materials={node.appearance.materials} />
  ) : (
    <Box
      aria-hidden='true'
      data-testid='component-color-icon'
      className='size-4 shrink-0'
      style={node.appearance?.color ? { fill: node.appearance.color } : undefined}
    />
  );

  const onHover = (componentId: string | undefined): void => {
    graphicsRef.send({ type: 'setHoveredModelComponent', unitId, componentId, source: 'explorer' });
  };
  const toggleSelection = (): void => {
    graphicsRef.send({
      type: 'toggleModelComponentSelection',
      unitId,
      componentId: node.id,
      source: 'explorer',
    });
  };
  const menuProps = {
    manifest,
    node,
    graphicsRef,
    unitId,
    source: 'explorer',
    isFocused,
    isIsolated,
    hasHiddenComponents,
    hasOpacityOverrides,
    opacity,
    preview,
    onRetryPreview: onRetryPreview
      ? () => {
          onRetryPreview(node.id);
        }
      : undefined,
    onPreviewDecodeError: preview?.bytes ? () => onPreviewDecodeError?.(node.id, preview.bytes!) : undefined,
    onPreviewDecoded: preview?.bytes ? () => onPreviewDecoded?.(node.id, preview.bytes!) : undefined,
  } as const;

  const row = (
    <div
      data-model-component-row=''
      data-model-component-unit-id={unitId}
      data-model-component-id={node.id}
      className={cn(
        // The sidebar row's lit states and inset: `pr-0.5` gives a 24 px action the 2 px it has above and below.
        'group/part relative flex w-full items-center justify-between rounded-md py-1 pr-0.5 pl-2 text-sm leading-5',
        // A part row leads with its 80 px preview; groups stay compact.
        isPreviewRow ? 'h-22 gap-2' : 'h-7',
        'focus-within:bg-sidebar-accent focus-within:text-sidebar-accent-foreground has-[[aria-haspopup=menu][data-state=open]]:bg-sidebar-accent',
        isSelected ? 'bg-primary/10 text-foreground' : 'text-sidebar-foreground',
        !isSelected && isFocused ? 'bg-sidebar-accent/70 text-foreground ring-1 ring-inset ring-primary/30' : undefined,
        !isSelected && !isFocused && isIsolated ? 'text-primary' : undefined,
        !isSelected && !isFocused ? 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground' : undefined,
        isHovered && !isSelected ? 'text-foreground' : undefined,
        isHidden ? 'opacity-45' : undefined,
      )}
      style={{ paddingLeft: `${getComponentRowPaddingLeft({ depth: node.depth, rootDepth })}px` }}
      onMouseEnter={() => {
        onHover(node.id);
      }}
      onMouseLeave={() => {
        onHover(undefined);
      }}
    >
      {Array.from({ length: guideCount }, (_, depth) => (
        <span
          // oxlint-disable-next-line react/no-array-index-key -- each position represents a stable ancestor depth
          key={depth}
          aria-hidden='true'
          className={cn(
            'pointer-events-none absolute inset-y-0 w-px bg-border/60 group-hover/part:opacity-100 group-focus-within/part:opacity-100',
            isSelected || isFocused ? 'opacity-100' : 'opacity-45',
          )}
          style={{ left: `${8 + depth * 12}px` }}
        />
      ))}
      {isPreviewRow ? (
        <PartPreviewFrame
          name={name}
          label={labels.preview(name)}
          preview={preview}
          className='size-20'
          fallback={swatch}
          tabIndex={-1}
          onOpen={
            openPartGallery
              ? (origin) => {
                  openPartGallery({ graphicsRef, unitId, componentId: node.id, source: 'explorer', origin });
                }
              : undefined
          }
          onDecodeError={preview?.bytes ? () => onPreviewDecodeError?.(node.id, preview.bytes!) : undefined}
          onDecoded={preview?.bytes ? () => onPreviewDecoded?.(node.id, preview.bytes!) : undefined}
        />
      ) : undefined}
      <button
        type='button'
        data-model-part-button=''
        data-model-component-id={node.id}
        tabIndex={activeRowId === undefined || activeRowId === node.id ? 0 : -1}
        className={cn(
          'flex h-full min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:focus-outline',
          // A preview row's name wraps beside its thumbnail, any material match under it.
          isPreviewRow ? 'flex-col justify-center gap-0.5' : 'items-center gap-2',
        )}
        aria-label={name}
        aria-pressed={isSelected}
        aria-busy={preview?.status === 'pending' || undefined}
        onClick={toggleSelection}
        onFocus={() => {
          onRowFocus?.(node.id);
        }}
        onKeyDown={(event) => {
          if (event.shiftKey && event.key === 'F10') {
            event.preventDefault();
            const rowElement = event.currentTarget.closest('[data-model-component-row]');
            if (rowElement) {
              const bounds = rowElement.getBoundingClientRect();
              rowElement.dispatchEvent(
                new MouseEvent('contextmenu', {
                  bubbles: true,
                  cancelable: true,
                  clientX: bounds.left + bounds.width / 2,
                  clientY: bounds.bottom,
                }),
              );
            }
          }
        }}
      >
        {isPreviewRow ? undefined : swatch}
        <span className={isPreviewRow ? 'line-clamp-2 wrap-break-word' : 'truncate'}>
          <HighlightText text={name} searchTerm={query} />
        </span>
        {preview?.status === 'pending' || preview?.status === 'failed' ? (
          <span className='sr-only'>
            {preview.status === 'pending' ? labels.previewLoading : labels.previewUnavailable}
          </span>
        ) : undefined}
        {materialMatchName ? (
          <span className='max-w-full truncate text-xs text-muted-foreground'>· {materialMatchName}</span>
        ) : undefined}
      </button>
      <RowActions isStacked={isPreviewRow}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              tabIndex={-1}
              className={actionButtonClassName}
              aria-label={visibilityAction.ariaLabel}
              onClick={() => {
                graphicsRef.send(visibilityAction.event);
              }}
            >
              <VisibilityIcon className='size-3.5' />
            </button>
          </TooltipTrigger>
          <TooltipContent>{visibilityAction.tooltip}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              tabIndex={-1}
              className={cn(actionButtonClassName, isolationAction.className)}
              aria-label={isolationAction.ariaLabel}
              aria-pressed={isolationAction.pressed}
              onClick={() => {
                graphicsRef.send(isolationAction.event);
              }}
            >
              <Target className='size-3.5' />
            </button>
          </TooltipTrigger>
          <TooltipContent>{isolationAction.tooltip}</TooltipContent>
        </Tooltip>
        {actions ? <actions.Dropdown {...menuProps} actionButtonClassName={actionButtonClassName} /> : undefined}
      </RowActions>
    </div>
  );

  if (!actions) {
    return row;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <actions.ContextContent {...menuProps} />
    </ContextMenu>
  );
});
