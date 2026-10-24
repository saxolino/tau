import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PaneviewApi } from 'dockview-react';
import type { GeometryComponentNode } from '@taucad/types';
import { SearchInput } from '@taucad/ui/components/search-input';
import type { PartThumbnailState } from '@taucad/viewer/cad/part-thumbnail-state';
import type { WorkbenchUnit } from '#host/workbench-host.jsx';
import { useWorkbenchPanesHost } from '#host/workbench-host.jsx';
import type { ModelComponentTarget, ModelPanelLayout, ModelSource } from '#model/model-source.js';
import { useModelPaneLabels } from '#model/model-labels.js';
import type {
  ModelComponentRevealTarget,
  ModelPaneviewPanelParams,
  ModelPropertiesPanelParams,
} from '#model/model-unit-section.jsx';
import {
  ExplorerEmptyState,
  ModelPaneviewHeader,
  ModelPaneviewPanel,
  ModelPropertiesPaneviewHeader,
  ModelPropertiesPaneviewPanel,
} from '#model/model-unit-section.jsx';
import { isPreviewablePart } from '#model/visible-components.js';
import { Paneview } from '#paneview/paneview.jsx';
import { paneviewAttachedSurfaceStyleOverrides, paneviewHeaderSize } from '#paneview/paneview-header.jsx';

const defaultLayout: ModelPanelLayout = {
  savedState: {},
  connectApi() {
    /* The host keeps no layout. */
  },
};
const useDefaultLayout = (): ModelPanelLayout => defaultLayout;

function getInitialPanelOptions(
  saved: ModelPanelLayout['savedState'],
  panelId: string,
  defaults: { isExpanded: boolean; size?: number },
): { isExpanded: boolean; size?: number } {
  const entry = saved[panelId];
  if (!entry) {
    return defaults;
  }
  return { isExpanded: entry.isExpanded, size: entry.size };
}

/**
 * The name each entry shows, by its path: the host's title, else the path itself.
 *
 * @param source - The host's Model source.
 * @param entryPaths - Every listed entry, main first.
 * @returns The title of an entry.
 */
function entryTitles(source: ModelSource | undefined, entryPaths: readonly string[]): (entryPath: string) => string {
  const entryTitle = source?.entryTitle;
  return entryTitle ? (entryPath) => entryTitle(entryPath, entryPaths) : (entryPath) => entryPath;
}

/**
 * The Model pane body: one filter over a section per geometry entry (its component tree) and a Properties section
 * for the selected part. Units come from the host's `useUnits`, everything else from its {@link ModelSource}.
 *
 * @param props - Called when a reveal request needs the pane on screen.
 * @returns The filter over the entry sections and the Properties section.
 * @public
 */
export function ModelPane({ onRequestOpen }: { readonly onRequestOpen?: () => void }): React.JSX.Element {
  const host = useWorkbenchPanesHost();
  const units = host.useUnits();
  const reveal = host.model?.reveal;
  const labels = useModelPaneLabels();
  const [query, setQuery] = useState('');
  const [revealTarget, setRevealTarget] = useState<ModelComponentRevealTarget>();
  const revealComponent = useCallback(
    (target: ModelComponentTarget) => {
      onRequestOpen?.();
      setQuery('');
      setRevealTarget((current) => ({
        entryPath: target.entryPath,
        unitId: target.unitId,
        componentId: target.componentId,
        requestId: (current?.requestId ?? 0) + 1,
      }));
    },
    [onRequestOpen],
  );
  useEffect(() => reveal?.subscribe(revealComponent), [reveal, revealComponent]);

  return (
    <div data-slot='model-panel-body' className='flex size-full min-h-0 flex-col overflow-hidden bg-sidebar text-sm'>
      <div data-slot='model-filter' className='shrink-0 bg-sidebar px-2 pt-2'>
        <SearchInput
          aria-label={labels.filter}
          placeholder={labels.filterPlaceholder}
          value={query}
          className='h-7 min-w-0 bg-background'
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onClear={() => {
            setQuery('');
          }}
        />
      </div>
      <div className='min-h-0 flex-1 overflow-hidden'>
        {units.length === 0 ? (
          <ExplorerEmptyState />
        ) : (
          <ModelPaneview
            units={units}
            query={query}
            revealTarget={revealTarget}
            onReveal={reveal?.request ?? revealComponent}
          />
        )}
      </div>
    </div>
  );
}

function ModelPaneview({
  units,
  query,
  revealTarget,
  onReveal,
}: {
  readonly units: readonly WorkbenchUnit[];
  readonly query: string;
  readonly revealTarget: ModelComponentRevealTarget | undefined;
  readonly onReveal: (target: ModelComponentTarget) => void;
}): React.JSX.Element {
  const source = useWorkbenchPanesHost().model;
  const usePanelLayout = source?.usePanelLayout ?? useDefaultLayout;
  const { savedState, connectApi } = usePanelLayout();
  const paneviewApiRef = useRef<PaneviewApi | undefined>(undefined);
  const entryPaths = useMemo(() => units.map(({ entryPath }) => entryPath), [units]);
  const paneviewKey = entryPaths.join('\0');
  const titleOf = useMemo(() => entryTitles(source, entryPaths), [entryPaths, source]);
  /* One model, one list: a lone entry the host names itself needs no section header. */
  const isHeaderHidden = source?.hideLoneEntryHeader === true && units.length === 1;
  const propertiesTitle = useModelPaneLabels().properties;
  const [selected, setSelected] = useState<ModelPropertiesPanelParams['selected'] & { readonly unitId: string }>();
  const [preview, setPreview] = useState<{
    readonly unitId: string;
    readonly componentId: string;
    readonly state: PartThumbnailState | undefined;
    readonly retry: () => void;
    readonly decodeError: () => void;
    readonly decoded: () => void;
  }>();
  const visibleSelection =
    selected && units.some(({ entryPath }) => entryPath === selected.entryPath) ? selected : undefined;
  const onSelectionChange = useCallback(
    (unitId: string, node: GeometryComponentNode | undefined, entryPath: string) => {
      setSelected((current) => (node ? { unitId, node, entryPath } : current?.unitId === unitId ? undefined : current));
    },
    [],
  );
  const onPreviewChange = useCallback(
    ({
      unitId,
      componentId,
      preview: state,
      retry,
      decodeError,
      decoded,
    }: Parameters<NonNullable<ModelPaneviewPanelParams['onPreviewChange']>>[0]) => {
      if (selected?.unitId !== unitId || selected.node.id !== componentId) {
        return;
      }
      setPreview({ unitId, componentId, state, retry, decodeError, decoded });
    },
    [selected],
  );
  const selectedPreview =
    preview?.unitId === visibleSelection?.unitId && preview?.componentId === visibleSelection?.node.id
      ? preview
      : undefined;
  const openPartGallery = source?.openPartGallery;
  const hasThumbnails = source?.useThumbnails !== undefined;
  const selectedGraphicsRef = units.find(({ entryPath }) => entryPath === visibleSelection?.entryPath)?.graphicsRef;
  const onOpenPreview = useMemo(
    () =>
      openPartGallery &&
      hasThumbnails &&
      selectedGraphicsRef &&
      visibleSelection &&
      isPreviewablePart(visibleSelection.node)
        ? (origin: HTMLElement) => {
            openPartGallery({
              graphicsRef: selectedGraphicsRef,
              unitId: visibleSelection.unitId,
              componentId: visibleSelection.node.id,
              source: 'explorer',
              origin,
            });
          }
        : undefined,
    [hasThumbnails, openPartGallery, selectedGraphicsRef, visibleSelection],
  );

  const handleReady = useCallback(
    ({ api }: { api: PaneviewApi }) => {
      paneviewApiRef.current = api;
      connectApi(api);

      for (const { entryPath, graphicsRef } of units) {
        const initial = getInitialPanelOptions(savedState, entryPath, { isExpanded: true, size: 200 });
        const title = titleOf(entryPath);
        api.addPanel({
          id: entryPath,
          title,
          component: 'modelPanel',
          headerComponent: 'modelHeader',
          // A headerless section cannot be collapsed, so it always opens.
          headerSize: isHeaderHidden ? 0 : paneviewHeaderSize,
          isExpanded: isHeaderHidden || initial.isExpanded,
          minimumBodySize: 144,
          size: initial.size,
          params: {
            entryPath,
            title,
            isHeaderHidden,
            graphicsRef,
            query,
            revealTarget,
            onReveal,
            onSelectionChange,
            onPreviewChange,
          } satisfies ModelPaneviewPanelParams,
        });
      }
      const initial = getInitialPanelOptions(savedState, 'properties', { isExpanded: true, size: 392 });
      api.addPanel({
        id: 'properties',
        title: propertiesTitle,
        component: 'propertiesPanel',
        headerComponent: 'propertiesHeader',
        headerSize: paneviewHeaderSize,
        isExpanded: initial.isExpanded,
        minimumBodySize: 160,
        size: initial.size,
        params: {
          selected: visibleSelection && { ...visibleSelection, entryTitle: titleOf(visibleSelection.entryPath) },
          preview: selectedPreview?.state,
          onOpenPreview,
          onRetryPreview: selectedPreview?.retry,
          onPreviewDecodeError: selectedPreview?.decodeError,
          onPreviewDecoded: selectedPreview?.decoded,
        } satisfies ModelPropertiesPanelParams,
      });
    },
    [
      connectApi,
      units,
      isHeaderHidden,
      propertiesTitle,
      titleOf,
      onOpenPreview,
      onPreviewChange,
      onReveal,
      onSelectionChange,
      selectedPreview,
      query,
      revealTarget,
      savedState,
      visibleSelection,
    ],
  );

  useEffect(() => {
    const api = paneviewApiRef.current;
    if (!api) {
      return;
    }

    for (const { entryPath, graphicsRef } of units) {
      api.getPanel(entryPath)?.api.updateParameters({
        entryPath,
        title: titleOf(entryPath),
        isHeaderHidden,
        graphicsRef,
        query,
        revealTarget: revealTarget?.entryPath === entryPath ? revealTarget : undefined,
        onReveal,
        onSelectionChange,
        onPreviewChange,
      });
    }
  }, [units, isHeaderHidden, onPreviewChange, onReveal, onSelectionChange, query, revealTarget, titleOf]);

  useEffect(() => {
    paneviewApiRef.current?.getPanel('properties')?.api.updateParameters({
      selected: visibleSelection && { ...visibleSelection, entryTitle: titleOf(visibleSelection.entryPath) },
      preview: selectedPreview?.state,
      onOpenPreview,
      onRetryPreview: selectedPreview?.retry,
      onPreviewDecodeError: selectedPreview?.decodeError,
      onPreviewDecoded: selectedPreview?.decoded,
    });
  }, [onOpenPreview, selectedPreview, titleOf, visibleSelection]);

  useEffect(() => {
    if (!revealTarget) {
      return;
    }
    paneviewApiRef.current?.getPanel(revealTarget.entryPath)?.api.setExpanded(true);
  }, [revealTarget]);

  return (
    <Paneview
      key={paneviewKey}
      className={paneviewAttachedSurfaceStyleOverrides}
      components={paneviewComponents}
      headerComponents={paneviewHeaderComponents}
      onReady={handleReady}
    />
  );
}

const paneviewComponents = { modelPanel: ModelPaneviewPanel, propertiesPanel: ModelPropertiesPaneviewPanel };
const paneviewHeaderComponents = { modelHeader: ModelPaneviewHeader, propertiesHeader: ModelPropertiesPaneviewHeader };
