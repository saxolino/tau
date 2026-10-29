import { SelectedPieceChip } from '#components/chat/selected-piece-chip.js';
import { useProjectAvailability } from '#hooks/use-project-availability.js';
import { ProjectSyncPlaceholder } from '#routes/w.$workspace.$project/project-sync-placeholder.js';
import { interactiveViewContent } from '#lib/interactive-view-content.js';
import type { AppCapabilitiesManifest } from '#types/runtime-client.alias.js';
import { useSelector } from '@xstate/react';
import { useManualEdits } from '#hooks/use-manual-edits.js';
import { useManualFaceTool } from '#hooks/use-manual-face-tool.js';
import { useManualDirectTool } from '#hooks/use-manual-direct-tool.js';
import { useManualSketchTool } from '#hooks/use-manual-sketch-tool.js';
import { ManualSketchBar } from '#routes/w.$workspace.$project/manual-sketch-bar.js';
import { matchesManualSidecarRevision } from '#services/manual-face-draft.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import { useProjectWorkspace } from '#routes/w.$workspace.$project/project-workspace-context.js';
import { cn } from '@taucad/ui/utils/cn';
import { useManualInspectorDraft } from '#routes/w.$workspace.$project/manual-inspector-draft.js';
import { ManualEditPanel } from '#routes/w.$workspace.$project/manual-edit-panel.js';
import { memo, useEffect, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { manualDocumentSchema } from '@taucad/smlib/manual-operations';
import { randomUuid } from '@taucad/utils/id';
import { useSelectedPiece } from '#hooks/use-selected-piece.js';
import { useProducibilityOverlay } from '#routes/w.$workspace.$project/producibilita-context.js';
import { faceDirection } from '#lib/inspector-selection.js';
import { GestureQuota } from '#routes/w.$workspace.$project/gesture-quota.js';
import type { FileEntry } from '@taucad/types';
import { asKnownArtifact } from '@taucad/runtime';
import type { Evaluation, Rendering, RuntimeDocument, ViewSubscription } from '@taucad/runtime';
import { canonicalJson } from '@taucad/utils/hash';
import type { IDockviewPanelHeaderProps } from 'dockview-react';
import { FileX, FolderOpen, PlayCircle } from 'lucide-react';
import { CadViewer } from '@taucad/viewer/cad/cad-viewer';
import { createModelAssembly } from '@taucad/viewer/graphics/three/react/model-assembly';
import { useModelComponentMenuActions } from '#components/geometry/cad/model-component-action-menu.js';
import { useOptionalPartThumbnailService } from '#providers/part-thumbnail-provider.js';
import { canonicalPartPreviews, sourceGlbDigest } from '#services/part-thumbnail-visual.js';
import type { PartThumbnailRequest } from '#services/part-thumbnail.service.js';
import type { PartThumbnailState } from '@taucad/viewer/cad/part-thumbnail-state';
import { FileSelector } from '#components/files/file-selector.js';
import { Button } from '@taucad/ui/components/button';
import { useProject } from '#hooks/use-project.js';
import { useFileTreeSelector } from '#hooks/use-file-tree.js';
import { useFileContent } from '#hooks/use-file-content.js';
import { useWorkbenchViewCommands } from '#workbench-records/view-actions.js';
import { useLiveViewOptions } from '#workbench-records/live-view-options.js';
import { setLocalInstanceChoice, useLocalInstanceChoice } from '#workbench-records/local-instance.js';
import { newViewRecord } from '#workbench-records/projection.js';
import { viewTabTitle } from '#workbench-records/view-titles.js';
import { CadProvider, useCad, useCadSelector } from '#hooks/use-cad.js';
import { GraphicsProvider, useGraphics, useGraphicsSelector } from '@taucad/viewer/hooks/use-graphics';
import type { ViewCameraSeed } from '@taucad/viewer/services/graphics-camera-registry';
import { ViewerIssues } from '#routes/w.$workspace.$project/chat-stack-trace.js';
import { ChatViewerStatus } from '#routes/w.$workspace.$project/chat-viewer-status.js';
import { ViewerAgentLayer } from '#routes/w.$workspace.$project/viewer-cantiere.js';
import {
  useRiferimentoVisore,
  ViewerReferencePanel,
  ViewerReferenceToggle,
} from '#routes/w.$workspace.$project/viewer-reference.js';
import { ChatViewerControls } from '#routes/w.$workspace.$project/chat-viewer-controls.js';
import { ViewerKernelSettings } from '#routes/w.$workspace.$project/chat-viewer-kernel-settings.js';
import { ViewerProjectionPicker } from '#routes/w.$workspace.$project/chat-viewer-projection-picker.js';
import { isEmptyGlb } from '@taucad/viewer/utils/inspect-glb';
import { ArButton } from '#components/cad/ar-button.js';
import { deriveModelInteractionUnitId } from '@taucad/viewer/machines/model-interaction.machine';
import {
  selectCadEvaluation,
  selectCadCapabilities,
  selectCadActiveKernelId,
  selectCadRendering,
  selectCadDocument,
  selectCadFailureIssues,
  selectIsCadLoading,
} from '#machines/cad.machine.js';
import { useViewerPartMenu } from '@taucad/workbench-panes/component-menu/use-viewer-part-menu';
import type { ViewerPartMenuDecorator } from '@taucad/workbench-panes/component-menu/use-viewer-part-menu';
import { ViewerStage } from '@taucad/workbench-panes/shell/viewer-stage';
import { ExactMeasurementProvider } from '@taucad/viewer/graphics/three/react/exact-measurement';
import type { ExactOccurrenceDistanceRequest } from '@taucad/viewer/graphics/three/react/exact-measurement';
import { measureExactOccurrenceDistance } from '#workers/measurement-exact.client.js';

const emptyViewerPreviewSnapshot: ReadonlyMap<string, PartThumbnailState> = new Map();

/** One visible Dockview pane owns one runtime view; the CAD unit separately keeps its default view. */
function usePaneRuntimeView({
  document,
  evaluation,
  capabilities,
  kernelId,
  selectedId,
  options,
  instance,
  blocked,
}: Readonly<{
  document: RuntimeDocument | undefined;
  evaluation: Evaluation | undefined;
  capabilities: AppCapabilitiesManifest | undefined;
  kernelId: string | undefined;
  selectedId: string | undefined;
  options: Record<string, unknown> | undefined;
  instance: string | undefined;
  blocked?: string;
}>): Readonly<{
  rendering: Rendering | undefined;
  unavailable: string | undefined;
  captureRendering: () => Promise<Rendering>;
}> {
  const [lastSuccess, setLastSuccess] = useState<{ key: string; rendering: Rendering } | undefined>();
  const [viewError, setViewError] = useState<{ key: string; message: string } | undefined>();
  const offered = evaluation?.success
    ? selectedId
      ? evaluation.views.find((view) => view.id === selectedId)
      : evaluation.views[0]
    : undefined;
  const requestedId = selectedId ?? offered?.id;
  const content = interactiveViewContent(offered?.mimeType, kernelId, capabilities);
  const includeEdges = content?.includeEdges === true;
  const activeView = useRef<{ key: string; view: ViewSubscription; closed: boolean } | undefined>(undefined);
  const unavailable =
    blocked ??
    (selectedId && evaluation?.success && !offered
      ? `Saved view “${selectedId}” is unavailable in this build.`
      : selectedId &&
          instance &&
          offered?.instances &&
          !offered.instances.some((offeredInstance) => offeredInstance.id === instance)
        ? `Saved instance “${instance}” is unavailable in view “${selectedId}”.`
        : undefined);
  const optionsKey = canonicalJson(options ?? {});
  const isEmpty = evaluation?.success === true && evaluation.views.length === 0;
  // The presented picture belongs to this document until a replacement succeeds,
  // including while the person switches views or a new view fails.
  const pictureKey = document?.id ?? '';
  const subscriptionKey = `${document?.id ?? ''}:${requestedId ?? ''}:${optionsKey}:${instance ?? ''}:${includeEdges}`;

  useEffect(() => {
    if (!document || Boolean(unavailable) || isEmpty) {
      return;
    }
    let closed = false;
    let view: ReturnType<typeof document.view>;
    try {
      const request = {
        options: JSON.parse(optionsKey) as Record<string, unknown>,
        ...(instance ? { instance } : {}),
        ...(includeEdges ? { content: { includeEdges: true } } : {}),
      };
      view = requestedId ? document.view(requestedId, request) : document.view();
    } catch (error) {
      queueMicrotask(() => {
        if (!closed) {
          setViewError({
            key: subscriptionKey,
            message: error instanceof Error ? error.message : 'The selected view failed',
          });
        }
      });
      return () => {
        closed = true;
      };
    }
    const active = { key: subscriptionKey, view, closed: false };
    activeView.current = active;
    const onRendering = (next: Rendering): void => {
      if (closed) {
        return;
      }
      if (next.success) {
        setLastSuccess({ key: pictureKey, rendering: next });
      }
      setViewError(
        next.success
          ? undefined
          : {
              key: subscriptionKey,
              message: next.issues.map((issue) => issue.message).join('; ') || 'View failed',
            },
      );
    };
    const unrendered = view.on('rendered', onRendering);
    const unstatus = view.on('status', (status) => {
      if (!closed && status === 'error') {
        setViewError((current) =>
          current?.key === subscriptionKey
            ? current
            : { key: subscriptionKey, message: 'The selected view is unavailable.' },
        );
      }
    });
    const readInitial = async (): Promise<void> => {
      try {
        const outcome = await view.rendering();
        if (!outcome.superseded) {
          onRendering(outcome.rendering);
        }
      } catch (error) {
        if (!closed) {
          setViewError({
            key: subscriptionKey,
            message: error instanceof Error ? error.message : 'The selected view failed',
          });
        }
      }
    };
    // async-iife: bootstrap — the subscription is the owner of its initial rendering settlement.
    void readInitial();
    return () => {
      closed = true;
      active.closed = true;
      if (activeView.current === active) {
        activeView.current = undefined;
      }
      unrendered();
      unstatus();
      view.close();
    };
  }, [document, isEmpty, requestedId, includeEdges, optionsKey, instance, unavailable, pictureKey, subscriptionKey]);

  const captureRendering = useCallback(async (): Promise<Rendering> => {
    const active = activeView.current;
    if (!active || active.key !== subscriptionKey || Boolean(unavailable) || isEmpty) {
      throw new Error('The selected view is unavailable for capture.');
    }
    const assertActive = (): void => {
      if (active.closed || activeView.current !== active) {
        throw new Error('The selected view changed during capture.');
      }
    };
    for (;;) {
      assertActive();
      // oxlint-disable-next-line no-await-in-loop -- Superseded evaluations must settle on the same pane subscription.
      const outcome = await active.view.rendering();
      assertActive();
      if (outcome.superseded) {
        continue;
      }
      if (!outcome.rendering.success || outcome.rendering.transient) {
        throw new Error('The selected view has no committed successful rendering for capture.');
      }
      return outcome.rendering;
    }
  }, [subscriptionKey, unavailable, isEmpty]);

  return {
    captureRendering,
    rendering:
      evaluation?.success && evaluation.views.length === 0
        ? undefined
        : lastSuccess?.key === pictureKey
          ? lastSuccess.rendering
          : undefined,
    // A failed evaluation fails every open view with the build's issues; the Issues card owns those.
    unavailable:
      unavailable ?? (evaluation?.success && viewError?.key === subscriptionKey ? viewError.message : undefined),
  };
}

type ChatViewerProps = {
  /** Unique Dockview panel ID for this viewer instance */
  readonly viewId: string;
  /** File path being rendered in this viewer (undefined = empty state) */
  readonly entryPath: string | undefined;
  /** Dockview panel API for updating title, etc. */
  readonly panelApi: IDockviewPanelHeaderProps['api'];
  readonly profile?: 'editor' | 'shared';
};

function MissingViewerFile({
  entryPath,
  onSelect,
}: {
  readonly entryPath: string;
  readonly onSelect: (path: string) => void;
}): React.JSX.Element {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-4 text-muted-foreground'>
      <FileX className='size-12 stroke-1' />
      <div className='flex flex-col items-center gap-1'>
        <p className='text-sm font-medium'>File not found</p>
        <p className='max-w-60 truncate text-xs'>{entryPath}</p>
      </div>
      <FileSelector
        selectedFile={undefined}
        placeholder='Select a file to render…'
        className='h-8 w-50'
        title='Viewport File'
        description='Choose a file to render in the viewport'
        searchPlaceholder='Search files…'
        emptyMessage='No files found.'
        onSelect={onSelect}
      />
    </div>
  );
}

const ChatViewerContent = memo(function ({
  viewId,
  entryPath,
  panelApi,
  profile = 'editor',
}: ChatViewerProps): React.JSX.Element {
  const { projectRef, viewGraphics, viewRecords, entriesRecord, geometryUnits, mainEntryPath, setViewEntryPath } =
    useProject();
  const viewCommands = useWorkbenchViewCommands();
  // Get the per-view graphics machine
  const graphicsActor = viewGraphics.get(viewId);

  // Get the geometry unit for this view's entry path
  const cadActor = entryPath ? geometryUnits.get(entryPath) : undefined;
  const measureExact = useMemo(
    () =>
      cadActor
        ? async (request: ExactOccurrenceDistanceRequest) =>
            measureExactOccurrenceDistance({ ...request, cadRef: cadActor })
        : undefined,
    [cadActor],
  );

  // Detect if the entry path is a directory: a listed directory entry, or a
  // prefix of a listed path when its directory has not been listed itself.
  // Selected as a boolean so a tree publication (every file write) re-renders
  // the viewer only when the answer changes.
  const selectIsDirectory = useCallback(
    (fileTree: ReadonlyMap<string, FileEntry>): boolean => {
      if (!entryPath) {
        return false;
      }

      const entry = fileTree.get(entryPath);
      if (entry) {
        return entry.type === 'dir';
      }

      const directoryPrefix = `${entryPath}/`;
      for (const key of fileTree.keys()) {
        if (key.startsWith(directoryPrefix)) {
          return true;
        }
      }

      return false;
    },
    [entryPath],
  );
  const isDirectory = useFileTreeSelector(selectIsDirectory);

  // Derive isMissing from content service orphan outcome (VS Code pattern).
  // useFileContent auto-loads on cache miss; missing files resolve to the
  // 'orphaned' outcome via the discriminated FileContentResult contract.
  const fileContent = useFileContent(entryPath);
  const isMissing = fileContent.kind === 'orphaned' && !isDirectory;

  useEffect(() => {
    if (!graphicsActor || (entryPath && !isDirectory && !isMissing)) {
      return;
    }
    const unitId = graphicsActor.getSnapshot().context.modelInteractionUnitId;
    graphicsActor.send({ type: 'clearArtifact' });
    if (unitId) {
      projectRef.send({ type: 'reconcileViewManifest', unitId });
    }
  }, [entryPath, graphicsActor, isDirectory, isMissing, projectRef]);

  // The project view record is the camera seed for this pane.
  const viewRecord = viewRecords.get(viewId);
  const savedCamera = viewRecord?.selectedKernelView
    ? viewRecord.kernelViews?.find((view) => view.id === viewRecord.selectedKernelView)?.camera
    : viewRecord?.camera;
  /* Create-only seed for this view's camera session, built when the viewer mounts its canvas. The
   * canvas-less branches mount no provider, so a directory or a missing file builds no camera (R8). */
  const cameraSeed: ViewCameraSeed = {
    identity: entryPath,
    camera: {
      cameraFovAngle: viewRecord?.fieldOfView,
      cameraView: savedCamera?.kind === 'pose' ? savedCamera : undefined,
    },
  };

  // Handle file selection in the viewport FileSelector
  const handleFileSelect = useCallback(
    (path: string) => {
      // Ensure geometry unit exists for the selected file
      if (!geometryUnits.has(path)) {
        projectRef.send({
          type: 'createGeometryUnit',
          entryPath: path,
          operationTimeout: entriesRecord?.entries[path]?.renderTimeout,
        });
      }

      /* Cuts and measurements are entry-scoped and the graphics actor is retained across a file switch,
       * so the live ones are removed here too; removing the last cut ends Section. Turning Section off
       * would keep the cuts, and the next persist would write the previous file's cuts and pinned
       * measurements -- placed on geometry that is gone -- into the new file's record. */
      const graphicsContext = graphicsActor?.getSnapshot().context;
      for (const { id } of graphicsContext?.sectionCuts ?? []) {
        graphicsActor?.send({ type: 'removeSectionCut', payload: id });
      }
      for (const { id } of graphicsContext?.measurements ?? []) {
        graphicsActor?.send({ type: 'clearMeasurement', payload: id });
      }
      graphicsActor?.send({ type: 'cancelCurrentMeasurement' });

      if (profile === 'editor') {
        void viewCommands.edit(viewId, (current) => ({
          ...(current ?? newViewRecord(path)),
          entryPath: path,
          camera: { kind: 'preset', preset: 'isometric' },
          section: { active: false, cuts: [] },
          measurements: [],
        }));
      }
      setViewEntryPath(viewId, path);

      // Update Dockview panel params so the component re-renders with new entryPath
      panelApi.updateParameters({ entryPath: path });

      // Update the Dockview panel title
      panelApi.setTitle(viewTabTitle({ ...(viewRecord ?? newViewRecord(path)), entryPath: path }));
    },
    [
      entriesRecord,
      projectRef,
      geometryUnits,
      graphicsActor,
      viewId,
      panelApi,
      setViewEntryPath,
      viewCommands,
      viewRecord,
      profile,
    ],
  );

  // A cloud project opens with a placeholder main file. Follow the real main
  // when its synced manifest arrives, but keep viewers on other chosen files.
  const previousMainEntryPath = useRef(mainEntryPath);
  useEffect(() => {
    const previous = previousMainEntryPath.current;
    previousMainEntryPath.current = mainEntryPath;
    if (entryPath === previous && mainEntryPath && mainEntryPath !== previous) {
      handleFileSelect(mainEntryPath);
    }
  }, [entryPath, handleFileSelect, mainEntryPath]);

  // If no graphics actor yet, render a placeholder
  if (!graphicsActor) {
    return (
      <div className='flex h-full items-center justify-center text-muted-foreground'>
        <span className='text-sm'>Initializing viewer…</span>
      </div>
    );
  }

  // If no file selected, render empty state with file selector
  if (!entryPath) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 text-muted-foreground'>
        <span className='text-sm'>No file selected</span>
        <FileSelector
          selectedFile={undefined}
          placeholder='Select file to render…'
          className='h-8 w-50'
          title='Viewport File'
          description='Choose which file to render in the viewport'
          searchPlaceholder='Search files…'
          emptyMessage='No files found.'
          onSelect={handleFileSelect}
        />
      </div>
    );
  }

  // If the entry path is a directory, show a friendly screen with a file selector
  if (isDirectory) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-4 text-muted-foreground'>
        <FolderOpen className='size-12 stroke-1' />
        <p className='text-sm'>The viewer cannot display a directory.</p>
        <FileSelector
          selectedFile={undefined}
          initialPath={entryPath}
          placeholder='Select a file to render…'
          className='h-8 w-50'
          title='Viewport File'
          description='Choose a file to render in the viewport'
          searchPlaceholder='Search files…'
          emptyMessage='No files found.'
          onSelect={handleFileSelect}
        />
      </div>
    );
  }

  // If the entry path doesn't exist in the file tree, show a friendly "not found" screen
  if (isMissing) {
    return <MissingViewerFile entryPath={entryPath} onSelect={handleFileSelect} />;
  }

  return (
    <CadProvider cadRef={cadActor}>
      <ExactMeasurementProvider measure={measureExact}>
        <GraphicsProvider graphicsRef={graphicsActor} seed={cameraSeed}>
          <ViewerContent viewId={viewId} entryPath={entryPath} profile={profile} panelApi={panelApi} />
        </GraphicsProvider>
      </ExactMeasurementProvider>
    </CadProvider>
  );
});

/** Announces absent geometry without hiding the interactive empty scene. */
function GeometryStatus({ isEmpty = false }: { readonly isEmpty?: boolean }): React.JSX.Element {
  const isCadLoading = useCadSelector(selectIsCadLoading, false);
  return (
    <div
      role='status'
      aria-label={isEmpty ? 'Empty model' : isCadLoading ? 'Loading geometry' : 'Waiting for geometry'}
      aria-busy={isCadLoading || undefined}
      className='sr-only'
    />
  );
}

/**
 * Inner content of a viewer panel with an active file.
 * Separated to avoid conditional hook usage in the parent.
 * CadProvider + GraphicsProvider are wrapped above this -- all descendants use
 * useCad()/useCadSelector() and useGraphics()/useGraphicsSelector().
 */
const ViewerContent = memo(function ({
  viewId,
  entryPath,
  profile,
  panelApi,
}: {
  readonly viewId: string;
  readonly entryPath: string;
  readonly profile: 'editor' | 'shared';
  readonly panelApi: ChatViewerProps['panelApi'];
}): React.JSX.Element {
  const { projectRef, entriesRecord, viewRecords, modelInteractionRef } = useProject();
  const { t, language } = useTranslation();
  const workspace = useProjectWorkspace({ enableNoContext: true });
  const [localManualOpen, setLocalManualOpen] = useState(false);
  const isManualOwner = workspace?.manualViewId === viewId;
  // One work mode: the tools are on whenever the inspector is on screen to hold them, for the viewer that owns them.
  const inspectorSlot = isManualOwner ? workspace.inspectorSlot : undefined;
  const isManualEditOpen = workspace ? inspectorSlot !== undefined : localManualOpen;
  const registerManualViewer = workspace?.registerManualViewer;
  const subscribePanelActive = useCallback(
    (listener: () => void) => {
      if (!registerManualViewer) {
        return () => undefined;
      }
      const subscription = panelApi.onDidActiveChange(() => {
        listener();
      });
      return () => {
        subscription.dispose();
      };
    },
    [panelApi, registerManualViewer],
  );
  const readPanelActive = useCallback(
    () => (registerManualViewer ? panelApi.isActive : true),
    [panelApi, registerManualViewer],
  );
  const isActiveViewer = useSyncExternalStore(subscribePanelActive, readPanelActive, readPanelActive);
  const { draftLayout, isToolOpen, onDraftLayoutChange } = useManualInspectorDraft({
    isOpen: isManualEditOpen,
    isActive: isActiveViewer,
  });
  const manualManifest = useSelector(
    modelInteractionRef,
    (state) => state.context.unitsById[deriveModelInteractionUnitId({ sourceFile: entryPath })]?.manifest,
  );
  const manualTargets = useMemo(
    () => [
      ...new Set(
        Object.values(manualManifest?.nodesById ?? {}).flatMap((node) => {
          const name = node.extras?.['manualTargetName'];
          return typeof name === 'string' && name.length > 0 ? [name] : [];
        }),
      ),
    ],
    [manualManifest],
  );
  const viewCommands = useWorkbenchViewCommands();
  const cadRef = useCad();
  const evaluation = useCadSelector(selectCadEvaluation, undefined);
  const defaultRendering = useCadSelector(selectCadRendering, undefined);
  const runtimeDocument = useCadSelector(selectCadDocument, undefined);
  const capabilities = useCadSelector(selectCadCapabilities, undefined);
  const kernelId = useCadSelector(selectCadActiveKernelId, undefined);
  const manualEdits = useManualEdits(entryPath, profile === 'editor' && kernelId === 'smlib');
  useEffect(() => {
    return registerManualViewer?.(viewId, profile === 'editor' && kernelId === 'smlib', isActiveViewer);
  }, [profile, kernelId, registerManualViewer, viewId, isActiveViewer]);
  // Loading only gates the manual-edit readiness below, so any other viewer must not re-render on every
  // loading flip (a render transition that presents no geometry re-renders nothing).
  const isManualCapable = profile === 'editor' && kernelId === 'smlib';
  const isCadLoading = useCadSelector((snapshot) => isManualCapable && selectIsCadLoading(snapshot), false);
  const savedView = viewRecords.get(viewId);
  const selectedKernelView = savedView?.selectedKernelView;
  const offeredViewId = selectedKernelView ?? (evaluation?.success ? evaluation.views[0]?.id : undefined);
  const selectedState = savedView?.kernelViews?.find((state) => state.id === offeredViewId);
  // The options panel's live draft leads the saved record, so edits re-render as they happen.
  const liveOptions = useLiveViewOptions(viewId);
  const viewOptions =
    liveOptions && liveOptions.viewId === offeredViewId ? liveOptions.options : selectedState?.options;
  const localInstance = useLocalInstanceChoice(viewId);
  const localForView = localInstance?.viewId === offeredViewId ? localInstance : undefined;
  const localExpired =
    localForView && localForView.evaluationId !== evaluation?.id
      ? `Instance “${localForView.instanceId}” belonged to a previous evaluation. Choose a current instance.`
      : undefined;
  const {
    rendering: paneRendering,
    unavailable,
    captureRendering,
  } = usePaneRuntimeView({
    document: runtimeDocument,
    evaluation,
    capabilities,
    kernelId,
    selectedId:
      selectedKernelView ??
      (Boolean(localForView) || Boolean(selectedState?.authoredInstance) || Boolean(viewOptions)
        ? offeredViewId
        : undefined),
    options: viewOptions,
    instance: localForView && !localExpired ? localForView.instanceId : selectedState?.authoredInstance,
    blocked: localExpired,
  });
  const rendering =
    evaluation?.success && evaluation.views.length === 0
      ? undefined
      : (paneRendering ?? (selectedKernelView ? undefined : defaultRendering));
  const knownArtifact = rendering?.success ? asKnownArtifact(rendering.artifact) : undefined;
  const emptyModel = useMemo(
    () =>
      (evaluation?.success === true && evaluation.views.length === 0) ||
      (knownArtifact?.mimeType === 'model/gltf-binary' && isEmptyGlb(knownArtifact.content)),
    [evaluation, knownArtifact],
  );
  const artifact = rendering?.success && !emptyModel ? rendering.artifact : undefined;
  // SinopiaCAD: a model the agent builds from nothing enters one piece at a time (viewer-cantiere.tsx).
  const [assembly] = useState(createModelAssembly);
  useEffect(
    () => () => {
      assembly.dispose();
    },
    [assembly],
  );
  const failureIssues = useCadSelector(selectCadFailureIssues, undefined);
  const failureMessage =
    failureIssues?.find((issue) => issue.severity === 'error')?.message ?? failureIssues?.[0]?.message;
  const overlayFailureMessage = profile === 'shared' ? failureMessage : undefined;
  const restoreDefaultView = (): void => {
    void viewCommands.edit(viewId, (current) => ({
      ...(current ?? newViewRecord(entryPath)),
      selectedKernelView: undefined,
    }));
    setLocalInstanceChoice(viewId, undefined);
  };

  // The geometry unit can be closed via the parameters panel context menu.
  // When that happens cadRef goes undefined, geometry clears, but the panel
  // stays open. Surface a "Reopen renderer" overlay so the user can re-spawn
  // the cad actor without having to re-add the panel.
  const isGeometryUnitClosed = !cadRef;
  const handleReopenRenderer = useCallback(() => {
    projectRef.send({
      type: 'createGeometryUnit',
      entryPath,
      operationTimeout: entriesRecord?.entries[entryPath]?.renderTimeout,
    });
  }, [entriesRecord, projectRef, entryPath]);

  // Bridge this pane's projection to its graphics owner. Other panes may show
  // different views of the same evaluated document without changing this one.
  const graphicsActor = useGraphics();
  const presentedUnitId = useGraphicsSelector((state) => state.context.modelInteractionUnitId);
  const presentedMediaType = useGraphicsSelector((state) => state.context.artifact?.mimeType);
  const previousPresentation = useRef({ unitId: presentedUnitId, mimeType: presentedMediaType });
  useEffect(() => {
    const previous = previousPresentation.current;
    previousPresentation.current = { unitId: presentedUnitId, mimeType: presentedMediaType };
    if (
      previous.unitId &&
      (previous.unitId !== presentedUnitId ||
        (previous.mimeType === 'model/gltf-binary' && presentedMediaType !== 'model/gltf-binary'))
    ) {
      projectRef.send({ type: 'reconcileViewManifest', unitId: previous.unitId });
    }
  }, [presentedUnitId, presentedMediaType, projectRef]);
  useEffect(() => {
    if (emptyModel) {
      graphicsActor.send({ type: 'clearArtifact' });
      return;
    }
    if (!rendering?.success) {
      return;
    }
    const known = asKnownArtifact(rendering.artifact);
    if (known) {
      graphicsActor.send({
        type: 'updateArtifact',
        artifact: known,
        hash: rendering.hash,
        sourceFile: rendering.sourceRevision?.entry ?? entryPath,
      });
    }
  }, [rendering, emptyModel, entryPath, graphicsActor]);

  // Select individual primitive values so that useSelector's reference equality
  // check works correctly. An object-returning selector creates a new reference
  // on every emission, causing unnecessary re-renders.
  const enableSurfaces = useGraphicsSelector((state) => state.context.enableSurfaces);
  const enableLines = useGraphicsSelector((state) => state.context.enableLines);
  const enableGizmo = useGraphicsSelector((state) => state.context.enableGizmo);
  // The image the model was built from, one click away in the bar (editor only: a shared view has no project files).
  const riferimento = useRiferimentoVisore(profile === 'editor');
  const enableGrid = useGraphicsSelector((state) => state.context.enableGrid);
  const enableAxes = useGraphicsSelector((state) => state.context.enableAxes);
  const enableMatcap = useGraphicsSelector((state) => state.context.enableMatcap);
  const upDirection = useGraphicsSelector((state) => state.context.upDirection);
  const partMenu = useViewerPartMenu({ graphicsRef: graphicsActor, actions: useModelComponentMenuActions() });
  const modelInteractionUnitId = useMemo(() => deriveModelInteractionUnitId({ sourceFile: entryPath }), [entryPath]);
  const thumbnails = useOptionalPartThumbnailService(modelInteractionUnitId);
  const previewSourceDigests = useRef(new WeakMap<Uint8Array<ArrayBuffer>, Promise<string>>());
  const [previewRetry, setPreviewRetry] = useState<{
    part: PartThumbnailRequest;
    requestId: number;
    sourceKey: string;
  }>();
  const submittedRetryId = useRef(0);
  const subscribePreviews = useCallback(
    (listener: () => void) => thumbnails?.subscribe(listener) ?? (() => undefined),
    [thumbnails],
  );
  const getPreviewSnapshot = useCallback(() => thumbnails?.snapshot() ?? emptyViewerPreviewSnapshot, [thumbnails]);
  const previews = useSyncExternalStore(subscribePreviews, getPreviewSnapshot, getPreviewSnapshot);
  const presentedArtifact = useGraphicsSelector((state) => state.context.artifact);
  const presentedArtifactKey = useGraphicsSelector((state) => state.context.artifactKey);
  // E1: the check in focus in the inspector, tinted on the model it was measured on.
  const producibilityOverlay = useProducibilityOverlay();
  const presentedSourceFile = useGraphicsSelector((state) => state.context.artifactSourceFile);
  const presentedKey = useGraphicsSelector((state) => state.context.gltfPresentation.presentedKey);
  // Only the settled key (a primitive): selecting the whole presentation object re-rendered the viewer on every
  // graphics transition, which the render-count test forbids.
  const settledPresentedKey = useGraphicsSelector((state) => {
    const { phase, requestedRevision, presentedRevision, presentedKey: key } = state.context.gltfPresentation;
    return phase === 'presented' && requestedRevision === presentedRevision ? key : undefined;
  });
  const manualProjectionReady =
    profile === 'editor' &&
    kernelId === 'smlib' &&
    !isCadLoading &&
    !failureIssues?.length &&
    !unavailable &&
    evaluation?.success === true &&
    !evaluation.transient &&
    rendering?.success === true &&
    !rendering.transient &&
    rendering.evaluationId === evaluation.id &&
    rendering.view === offeredViewId &&
    canonicalJson(rendering.sourceRevision ?? {}) === canonicalJson(evaluation.sourceRevision ?? {}) &&
    matchesManualSidecarRevision(manualEdits.contentDigest, rendering.sourceRevision, entryPath);
  const showManualProjection = (nextId: 'drawing' | 'model'): void => {
    const snapshot = cadRef?.getSnapshot();
    const current = snapshot?.context;
    if (
      !manualProjectionReady ||
      !snapshot ||
      selectIsCadLoading(snapshot) ||
      current?.document !== runtimeDocument ||
      current?.evaluation !== evaluation ||
      !evaluation.views.some((view) => view.id === nextId)
    ) {
      return;
    }
    setLocalInstanceChoice(viewId, undefined);
    void viewCommands.edit(viewId, (current) => {
      const record = current ?? newViewRecord(entryPath);
      return {
        ...record,
        selectedKernelView: nextId === evaluation.views[0]?.id ? undefined : nextId,
        kernelViews: record.kernelViews?.map((view) =>
          view.id === nextId ? { ...view, authoredInstance: undefined } : view,
        ),
      };
    });
  };
  const hasManualDrawing =
    manualProjectionReady &&
    evaluation.views.some((view) => view.id === 'drawing' && view.mimeType === 'image/svg+xml');
  const hasManualModel =
    manualProjectionReady &&
    evaluation.views.some((view) => view.id === 'model' && view.mimeType === 'model/gltf-binary');
  const faceReady =
    profile === 'editor' &&
    kernelId === 'smlib' &&
    !isCadLoading &&
    !failureIssues?.length &&
    !unavailable &&
    evaluation?.success === true &&
    !evaluation.transient &&
    rendering?.success === true &&
    !rendering.transient &&
    rendering.evaluationId === evaluation.id &&
    rendering.hash === presentedArtifactKey &&
    presentedSourceFile === entryPath &&
    settledPresentedKey === rendering.hash &&
    matchesManualSidecarRevision(manualEdits.contentDigest, rendering.sourceRevision, entryPath);
  const manualUnitId = deriveModelInteractionUnitId({ sourceFile: entryPath });
  // A piece picked by a tool is the page's one selection: the measures, the chip and the agent follow it.
  const selectManualPiece = useCallback(
    (componentId: string) => {
      modelInteractionRef.send({ type: 'selectComponent', unitId: manualUnitId, componentId, source: 'viewer' });
    },
    [modelInteractionRef, manualUnitId],
  );
  const faceTool = useManualFaceTool({
    edits: manualEdits,
    manifest: manualManifest,
    runtimeDocument,
    renderStamp: rendering?.success ? `${rendering.evaluationId}:${rendering.requestId}:${rendering.hash}` : undefined,
    artifactKey: presentedKey,
    ready: faceReady,
    open: isToolOpen,
    onSelectPiece: selectManualPiece,
  });
  const directTool = useManualDirectTool({
    edits: manualEdits,
    manifest: manualManifest,
    runtimeDocument,
    renderStamp: rendering?.success ? `${rendering.evaluationId}:${rendering.requestId}:${rendering.hash}` : undefined,
    artifactKey: presentedKey,
    ready: faceReady,
    open: isToolOpen,
    onSelectPiece: selectManualPiece,
  });
  // A piece chosen elsewhere (the measures list, a chip, the agent's summary) gets the body handles; a cleared
  // selection drops the face or the edges the tools held.
  const sharedPiece = useSelectedPiece(entryPath);
  const sharedPieceId = sharedPiece?.node.id;
  const sharedPieceName = sharedPiece?.node.extras?.['manualTargetName'];
  // E4: the sketch on the model; while it is open the face and body tools step aside.
  const sketch = useManualSketchTool({
    edits: manualEdits,
    manifest: manualManifest,
    ready: faceReady,
    open: isToolOpen,
    targets: manualTargets,
    selectedPiece: typeof sharedPieceName === 'string' ? sharedPieceName : undefined,
  });
  const isSketching = sketch.controls.active;
  const selectDirectPiece = directTool.controls.onSelectPiece;
  const clearFace = faceTool.controls.onClear;
  const cancelDirect = directTool.controls.onCancel;
  const directMode = directTool.controls.mode;
  const directPieceId = directTool.controls.selected?.componentId;
  const facePieceId = faceTool.controls.selected?.componentId;
  useEffect(() => {
    if (!isToolOpen || !faceReady) {
      return;
    }
    if (sharedPieceId === undefined) {
      if (facePieceId !== undefined) {
        clearFace?.();
      }
      if (directPieceId !== undefined) {
        cancelDirect();
      }
      return;
    }
    if (directMode === 'translate' || directMode === 'rotate' || directMode === 'scale') {
      if (directPieceId !== sharedPieceId) {
        selectDirectPiece?.(sharedPieceId);
      }
    } else if (facePieceId !== undefined && facePieceId !== sharedPieceId) {
      clearFace?.();
    } else if (
      (directMode === 'fillet' || directMode === 'chamfer') &&
      directPieceId !== undefined &&
      directPieceId !== sharedPieceId
    ) {
      cancelDirect();
    }
  }, [
    isToolOpen,
    faceReady,
    sharedPieceId,
    directMode,
    directPieceId,
    facePieceId,
    selectDirectPiece,
    clearFace,
    cancelDirect,
  ]);
  // The face or the edges narrow the inspector's title and the assistant's suggestions.
  const setInspectorSubSelection = isManualOwner ? workspace.setInspectorSubSelection : undefined;
  const faceNormal = faceTool.controls.selected?.normal;
  const subDirection = faceNormal ? faceDirection(faceNormal) : undefined;
  const edgeCount = directTool.controls.selected?.edgeCount ?? 0;
  const isEdgeMode = directMode === 'fillet' || directMode === 'chamfer';
  useEffect(() => {
    if (!setInspectorSubSelection) {
      return;
    }
    setInspectorSubSelection(
      facePieceId !== undefined && subDirection !== undefined
        ? { kind: 'face', componentId: facePieceId, direction: subDirection }
        : isEdgeMode && directPieceId !== undefined && edgeCount > 0
          ? { kind: 'edge', componentId: directPieceId, edgeCount }
          : undefined,
    );
  }, [setInspectorSubSelection, facePieceId, subDirection, isEdgeMode, directPieceId, edgeCount]);
  useEffect(() => () => setInspectorSubSelection?.(undefined), [setInspectorSubSelection]);
  // The inspector's size cells scale a piece in proportion through the same manual history.
  const setScalePiece = isManualOwner ? workspace.setScalePiece : undefined;
  const manualDocument = manualEdits.document;
  const commitManual = manualEdits.commit;
  useEffect(() => {
    if (!setScalePiece) {
      return;
    }
    if (!faceReady || !manualDocument) {
      setScalePiece(undefined);
      return;
    }
    setScalePiece(async (componentId, factor) => {
      const extras = manualManifest?.nodesById[componentId]?.extras;
      const name = extras?.['manualTargetName'];
      const bounds = extras?.['manualBounds'] as { min?: number[]; max?: number[] } | undefined;
      if (typeof name !== 'string' || !bounds?.min || !bounds.max || !(factor > 0) || !Number.isFinite(factor)) {
        return false;
      }
      const origin = [0, 1, 2].map((axis) => ((bounds.min![axis] ?? 0) + (bounds.max![axis] ?? 0)) / 2) as [
        number,
        number,
        number,
      ];
      const next = manualDocumentSchema.safeParse({
        ...manualDocument,
        operations: [
          ...manualDocument.operations,
          { id: randomUuid(), type: 'scale', target: { name }, origin, factor },
        ],
      });
      return next.success ? commitManual(next.data) : false;
    });
    return () => {
      setScalePiece(undefined);
    };
  }, [setScalePiece, faceReady, manualDocument, commitManual, manualManifest]);
  const viewerActionMenuData = partMenu.openMenuData;
  const viewerPart =
    viewerActionMenuData?.node.kind === 'part' && viewerActionMenuData.node.primitiveRefs?.length
      ? viewerActionMenuData.node
      : undefined;
  const retryPreview = useCallback(() => {
    if (!viewerPart || !presentedKey) {
      return;
    }
    const part = { id: viewerPart.id, primitives: viewerPart.primitiveRefs! };
    setPreviewRetry((current) => ({ part, requestId: (current?.requestId ?? 0) + 1, sourceKey: presentedKey }));
  }, [presentedKey, viewerPart]);
  useEffect(() => {
    if (previewRetry && previewRetry.sourceKey !== presentedKey) {
      // Retire an unsubmitted retry when its presented-source lifetime ends.
      submittedRetryId.current = previewRetry.requestId;
    }
    if (!thumbnails) {
      return;
    }
    thumbnails.announcePresentedSource(presentedKey);
    const pendingRetry =
      previewRetry && previewRetry.sourceKey === presentedKey && previewRetry.requestId !== submittedRetryId.current
        ? previewRetry
        : undefined;
    const requestedPart =
      pendingRetry?.part ?? (viewerPart ? { id: viewerPart.id, primitives: viewerPart.primitiveRefs! } : undefined);
    if (
      !requestedPart ||
      presentedArtifact?.mimeType !== 'model/gltf-binary' ||
      presentedArtifactKey !== presentedKey
    ) {
      thumbnails.releaseOwner('viewer');
      return;
    }
    let active = true;
    const { content } = presentedArtifact;
    if (content.buffer.byteLength > 64 * 1024 * 1024) {
      thumbnails.failPreparationForOwner(
        'viewer',
        [requestedPart],
        new RangeError('Part thumbnail source exceeds 64 MiB'),
      );
      return;
    }
    let sourceDigest = previewSourceDigests.current.get(content);
    if (!sourceDigest) {
      sourceDigest = sourceGlbDigest(content);
      previewSourceDigests.current.set(content, sourceDigest);
    }
    const prepare = async (): Promise<void> => {
      try {
        const [hash, prepared] = await Promise.all([
          sourceDigest,
          canonicalPartPreviews(content, [requestedPart.primitives]),
        ]);
        if (active) {
          thumbnails.requestForOwner(
            'viewer',
            {
              sourcePath: entryPath,
              geometryHash: hash,
              content,
              renderContent: prepared.renderContent,
            },
            [{ ...requestedPart, visualKey: prepared.previews[0]?.key ?? prepared.visualKey }],
            pendingRetry ? { manualPartId: pendingRetry.part.id } : undefined,
          );
          if (pendingRetry) {
            submittedRetryId.current = pendingRetry.requestId;
          }
        }
      } catch (error) {
        if (active) {
          if (previewSourceDigests.current.get(content) === sourceDigest) {
            previewSourceDigests.current.delete(content);
          }
          thumbnails.failPreparationForOwner('viewer', [requestedPart], error);
        }
      }
    };
    void prepare();
    return () => {
      active = false;
    };
  }, [entryPath, presentedArtifact, presentedArtifactKey, presentedKey, previewRetry, thumbnails, viewerPart]);
  useEffect(() => () => thumbnails?.releaseOwner('viewer'), [thumbnails]);
  const decoratePartMenu = useCallback<ViewerPartMenuDecorator>(
    (data) => ({
      ...data,
      preview: previews.get(data.node.id),
      onRetryPreview: retryPreview,
      onPreviewDecodeError: () => {
        const state = previews.get(data.node.id);
        if (state?.bytes) {
          thumbnails?.failDecode(data.node.id, state.bytes);
        }
      },
      onPreviewDecoded: () => {
        const state = previews.get(data.node.id);
        if (state?.bytes) {
          thumbnails?.markDecoded(data.node.id, state.bytes);
        }
      },
    }),
    [previews, retryPreview, thumbnails],
  );

  const closePartMenu = partMenu.close;
  useEffect(() => {
    if (isGeometryUnitClosed) {
      closePartMenu();
    }
  }, [closePartMenu, isGeometryUnitClosed]);

  const manualPanel = (onClose: (() => void) | undefined): React.JSX.Element => (
    <ManualEditPanel
      key={entryPath}
      onDraftLayoutChange={onDraftLayoutChange}
      document={manualEdits.document}
      targets={manualTargets}
      onCommit={manualEdits.commit}
      onUndo={manualEdits.undo}
      onRedo={manualEdits.redo}
      canUndo={manualEdits.canUndo}
      canRedo={manualEdits.canRedo}
      isLoading={manualEdits.loading}
      isSaving={manualEdits.saving}
      error={manualEdits.error}
      faceControls={faceTool.controls}
      directControls={directTool.controls}
      sketchControls={sketch.controls}
      onShowProfiles={
        hasManualDrawing && offeredViewId !== 'drawing'
          ? () => {
              showManualProjection('drawing');
            }
          : undefined
      }
      onShowModel={
        hasManualModel && offeredViewId === 'drawing'
          ? () => {
              showManualProjection('model');
            }
          : undefined
      }
      onClose={onClose}
      historySlot={isManualOwner ? workspace.inspectorHistorySlot : undefined}
    />
  );
  const sketchQuota = isSketching ? sketch.controls.liveQuota : undefined;
  const sketchQuotaText = sketchQuota
    ? `${sketchQuota.kind === 'radius' ? 'R ' : ''}${sketchQuota.values
        .map((value) => formatNumber(value, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
        .join(' × ')} mm`
    : undefined;
  const gestureQuota =
    sketchQuotaText ??
    (faceTool.controls.isDragging && faceTool.controls.action !== 'hole'
      ? faceTool.controls.distance
      : directTool.controls.isDragging && directTool.controls.preview
        ? directTool.controls.preview
        : undefined);
  const isModelShown = !isGeometryUnitClosed && Boolean(artifact && presentedArtifact);
  return (
    <div className='@container/manual-viewer relative h-full min-h-0 min-w-0'>
      <div className='flex h-full min-h-0 min-w-0'>
        <ViewerStage
          className='min-h-0 min-w-0 flex-1'
          graphicsRef={graphicsActor}
          regionId={`viewport-gizmo-container-${viewId}`}
          data-testid='chat-viewer-layout'
          partMenu={partMenu}
          decoratePartMenu={decoratePartMenu}
          isModelShown={isModelShown}
          status={overlayFailureMessage ? { kind: 'failed', message: overlayFailureMessage } : undefined}
          statusExtra={
            <>
              <ChatViewerStatus />
              {unavailable && profile !== 'editor' ? (
                <div role='alert' className='rounded-md border border-border bg-background/95 p-3 text-sm shadow-sm'>
                  <p>{unavailable}</p>
                  <Button size='sm' variant='outline' className='mt-2' onClick={restoreDefaultView}>
                    Use default view
                  </Button>
                </div>
              ) : null}
            </>
          }
          // Working on the model during its assembly draws every piece at once.
          onPointerDownCapture={assembly.finish}
          onKeyDown={(event) => {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.nativeEvent.isComposing ||
              evaluation?.success !== true ||
              evaluation.views.length < 2
            ) {
              return;
            }
            const { target } = event;
            if (
              !(target instanceof HTMLElement) ||
              target.isContentEditable ||
              target.closest('input, textarea, select, [contenteditable], [role="textbox"], .monaco-editor')
            ) {
              return;
            }
            const index = Number(event.key) - 1;
            const next = Number.isInteger(index) && index >= 0 && index < 3 ? evaluation.views[index] : undefined;
            if (!next) {
              return;
            }
            event.preventDefault();
            setLocalInstanceChoice(viewId, undefined);
            void viewCommands.edit(viewId, (current) => ({
              ...(current ?? newViewRecord(entryPath)),
              selectedKernelView: next.id,
            }));
          }}
          renderCanvas={({ eventSource, gizmoContainer, onComponentSecondaryPointerCandidate }) =>
            isGeometryUnitClosed ? null : (
              <CadViewer
                planarFaceTool={isSketching ? sketch.planeTool : faceTool.tool}
                directEditTool={isSketching ? undefined : directTool.tool}
                sketchTool={sketch.tool}
                producibilityOverlay={producibilityOverlay}
                enableZoom
                enablePan
                secondaryMouseButtonMode='camera-pan'
                enableGizmo={enableGizmo}
                enableGrid={enableGrid}
                enableAxes={enableAxes}
                enableSurfaces={enableSurfaces}
                enableLines={enableLines}
                enableMatcap={enableMatcap}
                upDirection={upDirection}
                artifact={artifact ? presentedArtifact : undefined}
                artifactHash={presentedArtifactKey}
                sourceFile={presentedSourceFile}
                // Keep R3F on default offsetX/Y compute; eventPrefix='client'
                // is window-relative and mis-rays docked panels.
                eventSource={eventSource}
                gizmoContainer={gizmoContainer}
                onModelComponentSecondaryPointerCandidate={onComponentSecondaryPointerCandidate}
                assembly={profile === 'editor' ? assembly : undefined}
              />
            )
          }
          /* Bottom controls: the bar is centred on the last line and grows upward as tools start. In the editor it starts
         with the view menus and the build status, and the issues list unfolds above its controls. The AR button
         (mobile iOS only) has the line above it, so the bar never covers it. In a pane narrower than the bar, the
         bar starts at the left edge, keeping the grid readout and Section in view. */
          controls={
            <>
              <div className='flex w-full items-end gap-2 [&>*]:pointer-events-auto'>
                <ArButton artifact={artifact} runtimeDocument={runtimeDocument} className='ml-auto shrink-0' />
              </div>
              {profile === 'editor' ? (
                <ViewerIssues
                  entryPath={entryPath}
                  notice={
                    unavailable
                      ? { message: unavailable, actionLabel: 'Use default view', onAct: restoreDefaultView }
                      : undefined
                  }
                >
                  {({ segment, list }) => (
                    <ChatViewerControls
                      captureRendering={captureRendering}
                      kernelSettings={
                        cadRef ? (
                          <ViewerKernelSettings viewId={viewId} entryPath={entryPath} cadActor={cadRef} />
                        ) : undefined
                      }
                      leading={
                        <>
                          {cadRef ? (
                            <ViewerProjectionPicker viewId={viewId} entryPath={entryPath} cadActor={cadRef} />
                          ) : null}
                          {kernelId === 'smlib' && !workspace ? (
                            <Button
                              size='sm'
                              variant={isManualEditOpen ? 'secondary' : 'ghost'}
                              aria-pressed={isManualEditOpen}
                              onClick={() => {
                                setLocalManualOpen(!isManualEditOpen);
                              }}
                            >
                              {t('project.topBar.modify')}
                            </Button>
                          ) : null}
                          {segment}
                        </>
                      }
                      aboveControls={
                        <>
                          <ManualSketchBar controls={sketch.controls} />
                          {list}
                        </>
                      }
                      reference={
                        riferimento.riferimenti.length > 0 ? (
                          <ViewerReferenceToggle riferimento={riferimento} />
                        ) : undefined
                      }
                    />
                  )}
                </ViewerIssues>
              ) : (
                <ChatViewerControls shouldEnableCapture={false} captureRendering={captureRendering} />
              )}
            </>
          }
        >
          {profile === 'editor' ? (
            <ViewerAgentLayer
              assembly={assembly}
              entryPath={entryPath}
              isModelShown={isModelShown}
              isModelEmpty={emptyModel}
            />
          ) : null}
          <SelectedPieceChip entryPath={entryPath} location='viewer' />
          {gestureQuota === undefined ? null : (
            <GestureQuota
              value={gestureQuota}
              editing={
                isSketching && sketch.controls.typing && sketchQuota
                  ? {
                      label: t(`sketch.quota.${sketchQuota.kind}`),
                      onSubmit: sketch.controls.onQuotaSubmit,
                      onCancel: sketch.controls.onQuotaCancel,
                    }
                  : undefined
              }
            />
          )}
          {!artifact && !overlayFailureMessage ? <GeometryStatus isEmpty={emptyModel} /> : null}
          {/* Reopen-renderer overlay — shown when the geometry unit was closed */}
          {isGeometryUnitClosed && (
            <div className='pointer-events-none absolute inset-0 z-20 flex items-center justify-center'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='pointer-events-auto shadow-lg'
                onClick={handleReopenRenderer}
              >
                <PlayCircle />
                Reopen renderer
              </Button>
            </div>
          )}
        </ViewerStage>
        {/* Beside the stage, not in its canvas region: the panel's clicks and keys never reach the canvas (no orbit, no
            part picked). It is placed in the viewer's own box; the inline tools' panel, when open, keeps that corner. */}
        {profile === 'editor' && !(isManualEditOpen && !workspace) ? (
          <ViewerReferencePanel riferimento={riferimento} isBelowGizmo={enableGizmo} />
        ) : null}
        {profile === 'editor' && kernelId === 'smlib' && workspace && inspectorSlot
          ? createPortal(manualPanel(undefined), inspectorSlot)
          : null}
        {profile === 'editor' && kernelId === 'smlib' && !workspace ? (
          <div
            hidden={!isManualEditOpen}
            inert={!isManualEditOpen}
            className={cn(
              'absolute inset-y-0 right-0 z-20 h-full max-w-full min-h-0 shrink-0 overflow-y-auto border-l bg-sidebar @4xl/manual-viewer:static',
              draftLayout === 'profile' ? 'w-full @4xl/manual-viewer:w-140' : 'w-96',
            )}
          >
            {manualPanel(() => {
              setLocalManualOpen(false);
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/** Keep file absence and rendering errors hidden until the authored checkout is acknowledged. */
export const ChatViewer = memo(function (props: ChatViewerProps): React.JSX.Element {
  const availability = useProjectAvailability();
  return props.profile !== 'shared' && availability !== 'ready' ? (
    <ProjectSyncPlaceholder state={availability} />
  ) : (
    <ChatViewerContent {...props} />
  );
});
