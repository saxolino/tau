/**
 * The Tau viewer page: one bundle, two compositions (blueprint D10, I7).
 *
 * Inline (a card in the conversation) draws the canvas and two actions; the
 * tab (Codex's thread tab, fullscreen on any host, the loopback page) adds the
 * bottom control bar. Everything the page shows comes through the host bridge.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActorRef } from '@xstate/react';
import { FlipHorizontal, Maximize2, MessageSquarePlus, Ruler } from 'lucide-react';
import type { TauViewerModel } from '@taucad/mcp/viewer-protocol';
import type { Artifact } from '@taucad/runtime';
import type { GeometryComponentReference } from '@taucad/types';
import { Button } from '@taucad/ui/components/button';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { Separator } from '@taucad/ui/components/separator';
import { TooltipProvider } from '@taucad/ui/components/tooltip';
import { cn } from '@taucad/ui/utils/cn';
import { FitViewControl } from '@taucad/viewer/cad/fit-view-control';
import { GridSizeIndicator } from '@taucad/viewer/cad/grid-control';
import { MeasureControl } from '@taucad/viewer/cad/measure-control';
import { MeasurementList, MeasureOptions } from '@taucad/viewer/cad/measure-tool-row';
import { SectionViewControl } from '@taucad/viewer/cad/section-view-control';
import { SectionEditor, SectionOptions, SectionStatus } from '@taucad/viewer/cad/section-tool-row';
import { ViewerEnvironmentProvider, defaultViewerEnvironment } from '@taucad/viewer/environment/viewer-environment';
import type { ViewerEnvironment } from '@taucad/viewer/environment/viewer-environment';
import { defaultGraphicsSettings } from '@taucad/viewer/graphics/graphics-settings';
import { GraphicsProvider, useGraphics, useGraphicsSelector } from '@taucad/viewer/hooks/use-graphics';
import { graphicsMachine } from '@taucad/viewer/machines/graphics.machine';
import { ModelViewer } from '@taucad/viewer/model-viewer';
import type { HostBridge, HostView } from '#app/host-bridge.js';
import { loadModel } from '#app/model-loader.js';
import { chatReferenceOf } from '#app/chat-reference.js';

type Loaded = Readonly<{ model: TauViewerModel; artifact: Artifact }>;

type PageState =
  | Readonly<{ kind: 'waiting' }>
  | Readonly<{ kind: 'loading'; model: TauViewerModel; loaded: number; previous?: Loaded }>
  | Readonly<{ kind: 'ready'; current: Loaded }>
  | Readonly<{ kind: 'failed'; message: string; previous?: Loaded }>;

const previousOf = (state: PageState): Loaded | undefined =>
  state.kind === 'ready' ? state.current : state.kind === 'waiting' ? undefined : state.previous;

/** Follows the bridge: shows each model it hands over, keeping the last one on screen while the next loads. */
function useShownModel(bridge: HostBridge): readonly [PageState, HostView] {
  const [state, setState] = useState<PageState>({ kind: 'waiting' });
  const [view, setView] = useState<HostView>(() => bridge.view());
  const shownSha = useRef<string | undefined>(undefined);

  useEffect(() => {
    let current = 0;
    return bridge.subscribe((event) => {
      if (event.type === 'context') {
        setView(event.view);
        return;
      }
      if (event.type === 'error') {
        setState((previous) => ({ kind: 'failed', message: event.message, previous: previousOf(previous) }));
        return;
      }
      const { model } = event.result;
      if (model.sha256 === shownSha.current) {
        return;
      }
      shownSha.current = model.sha256;
      current += 1;
      const request = current;
      setState((previous) => ({ kind: 'loading', model, loaded: 0, previous: previousOf(previous) }));
      const load = async (): Promise<void> => {
        try {
          const artifact = await loadModel(bridge.callTool, model, (loaded) => {
            if (request === current) {
              setState((previous) => (previous.kind === 'loading' ? { ...previous, loaded } : previous));
            }
          });
          if (request === current) {
            setState({ kind: 'ready', current: { model, artifact } });
          }
        } catch (error) {
          if (request === current) {
            shownSha.current = undefined;
            setState((previous) => ({
              kind: 'failed',
              message: error instanceof Error ? error.message : String(error),
              previous: previousOf(previous),
            }));
          }
        }
      };
      // async-iife: bootstrap — a host event starts the load; its outcome lands in state, and a newer model supersedes it.
      void load();
    });
  }, [bridge]);

  return [state, view] as const;
}

/** A running tool's row: its name, its options, then Done (the app's `ToolRow`, without the app's focus hand-off). */
function ToolRow({
  name,
  icon,
  above,
  children,
  onDone,
}: Readonly<{
  name: string;
  icon: React.ReactNode;
  above?: React.ReactNode;
  children: React.ReactNode;
  onDone: () => void;
}>): React.JSX.Element {
  return (
    <div role='group' aria-label={`${name} options`} className='flex max-w-full flex-col gap-1 border-b pb-1'>
      {above}
      <div className='flex min-h-7 items-center gap-1'>
        <span className='flex shrink-0 items-center gap-1 px-1 text-xs font-medium'>
          {icon}
          <span>{name}</span>
        </span>
        <Separator orientation='vertical' className='mx-1 data-[orientation=vertical]:h-4' />
        {children}
        <Button variant='secondary' size='xs' className='h-7' onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/** The tab composition's bottom bar: grid readout, Section, Measure and Fit, each running tool's row above them. */
function ViewerBar({ actions }: Readonly<{ actions: React.ReactNode }>): React.JSX.Element {
  const graphicsRef = useGraphics();
  const is2d = useGraphicsSelector((state) => state.context.artifact?.mimeType === 'image/svg+xml');
  const isSectionViewActive = useGraphicsSelector((state) => state.context.isSectionViewActive);
  const isMeasureActive = useGraphicsSelector((state) => state.context.isMeasureActive);
  const measurementCount = useGraphicsSelector((state) => state.context.measurements.length);
  const [measurementsExpanded, setMeasurementsExpanded] = useState(false);

  return (
    <div className='pointer-events-auto flex max-w-full min-w-min flex-col gap-1 rounded-lg border bg-sidebar p-1 shadow-xs'>
      {!is2d && isSectionViewActive ? (
        <ToolRow
          name='Section view'
          icon={<FlipHorizontal className='size-4 text-viewer-tool-active' />}
          above={
            <>
              <SectionEditor />
              <SectionStatus />
            </>
          }
          onDone={() => {
            graphicsRef.send({ type: 'setSectionViewActive', payload: false });
          }}
        >
          <SectionOptions />
        </ToolRow>
      ) : null}
      {!is2d && isMeasureActive ? (
        <ToolRow
          name='Measuring'
          icon={<Ruler className='size-4 -rotate-45 text-viewer-tool-active' />}
          above={
            measurementsExpanded && measurementCount > 0 ? (
              <MeasurementList
                onEmptied={() => {
                  setMeasurementsExpanded(false);
                }}
              />
            ) : null
          }
          onDone={() => {
            setMeasurementsExpanded(false);
            graphicsRef.send({ type: 'setMeasureActive', payload: false });
          }}
        >
          <MeasureOptions expanded={measurementsExpanded} onExpandedChange={setMeasurementsExpanded} />
        </ToolRow>
      ) : null}
      <div
        role='group'
        aria-label='Viewer controls'
        className='flex flex-wrap items-center justify-center gap-1 self-center text-muted-foreground [&_button]:font-normal [&_button:hover]:text-foreground [&_button[aria-pressed=true]]:text-foreground'
      >
        <GridSizeIndicator />
        {is2d ? null : (
          <>
            <SectionViewControl />
            <MeasureControl />
          </>
        )}
        <FitViewControl />
        <Separator orientation='vertical' className='first:hidden data-[orientation=vertical]:h-4' />
        {actions}
      </div>
    </div>
  );
}

/** What the canvas shows besides the model: progress, a failure, or the wait for a first model. */
function StatusLine({ state }: Readonly<{ state: PageState }>): React.ReactNode {
  if (state.kind === 'loading') {
    const percent = state.model.byteLength === 0 ? 100 : Math.round((state.loaded / state.model.byteLength) * 100);
    return (
      <p role='status' className='text-xs text-muted-foreground'>
        Loading {state.model.title}… {percent}%
      </p>
    );
  }
  if (state.kind === 'failed') {
    return (
      <p role='alert' className='text-xs text-feature'>
        {state.message}
      </p>
    );
  }
  return null;
}

/**
 * The page.
 *
 * @param props - The connected host bridge.
 * @returns The viewer in the composition the host asks for.
 */
export function ViewerPage({ bridge }: Readonly<{ bridge: HostBridge }>): React.JSX.Element {
  const [state, view] = useShownModel(bridge);
  const [selected, setSelected] = useState<GeometryComponentReference | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const graphicsRef = useActorRef(graphicsMachine, {
    input: {
      enableSurfaces: defaultGraphicsSettings.enableSurfaces,
      enableLines: defaultGraphicsSettings.enableLines,
      enableGizmo: defaultGraphicsSettings.enableGizmo,
      enableGrid: defaultGraphicsSettings.enableGrid,
      enableAxes: defaultGraphicsSettings.enableAxes,
      enableMatcap: defaultGraphicsSettings.enableMatcap,
      enablePostProcessing: defaultGraphicsSettings.enablePostProcessing,
      upDirection: defaultGraphicsSettings.upDirection,
      /* The sandboxed frame gets WebGL (I6). */
      graphicsBackend: 'webgl',
    },
  });
  const environment = useMemo(
    (): ViewerEnvironment => ({
      ...defaultViewerEnvironment,
      colorScheme: view.colorScheme,
      graphicsBackend: 'webgl',
      /* The page prints no status text of its own (E2). */
      showRenderFps: false,
    }),
    [view.colorScheme],
  );
  const shown = state.kind === 'ready' ? state.current : previousOf(state);
  const isInline = view.composition === 'inline';

  useEffect(() => {
    setSelected(undefined);
  }, [shown?.model.sha256]);

  const addToChat = useCallback(() => {
    if (shown === undefined) {
      return;
    }
    const add = async (): Promise<void> => {
      try {
        const outcome = await bridge.addToChat(chatReferenceOf(shown.model, selected));
        setNotice(outcome === 'added' ? 'Added to chat' : 'Copied; paste it into your chat');
      } catch {
        setNotice('Could not add to chat');
      }
    };
    // async-iife: bootstrap — a click starts it; the notice reports its outcome.
    void add();
  }, [bridge, shown, selected]);

  useEffect(() => {
    if (notice === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      setNotice(undefined);
    }, 2500);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  /* In a card the conversation owns the wheel and vertical pan (E5, G21);
   * controls are 44 pt there and the canvas height is fixed. */
  const actions = (
    <>
      <Button
        variant='ghost'
        size={isInline ? 'default' : 'xs'}
        className={cn(isInline && 'min-h-11')}
        disabled={shown === undefined}
        onClick={addToChat}
      >
        <MessageSquarePlus className='size-4' />
        {view.canAddToChat ? 'Add to chat' : 'Copy prompt'}
      </Button>
      {isInline && view.canRequestFullscreen ? (
        <Button
          variant='ghost'
          className='min-h-11'
          onClick={() => {
            void bridge.requestFullscreen();
          }}
        >
          <Maximize2 className='size-4' />
          Open full view
        </Button>
      ) : null}
    </>
  );

  return (
    <ViewerEnvironmentProvider value={environment}>
      <KeyboardProvider>
        <TooltipProvider>
          <GraphicsProvider graphicsRef={graphicsRef}>
            <main
              data-composition={view.composition}
              className={cn(
                '@container/viewer flex flex-col bg-background text-foreground',
                isInline ? 'h-[420px]' : 'h-dvh',
              )}
              style={{
                paddingTop: view.safeArea.top,
                paddingRight: view.safeArea.right,
                paddingBottom: view.safeArea.bottom,
                paddingLeft: view.safeArea.left,
              }}
            >
              <div className='relative min-h-0 flex-1'>
                {shown === undefined && state.kind !== 'loading' ? (
                  <div className='flex size-full items-center justify-center p-4 text-center'>
                    {state.kind === 'failed' ? (
                      <StatusLine state={state} />
                    ) : (
                      <p className='text-sm text-muted-foreground'>Waiting for a model.</p>
                    )}
                  </div>
                ) : (
                  <ModelViewer
                    graphicsRef={graphicsRef}
                    artifact={shown?.artifact}
                    artifactHash={shown?.model.sha256}
                    sourceFile={shown?.model.sourceFile}
                    enablePan={!isInline}
                    enableZoom={!isInline}
                    graphicsOptions={{
                      enableGrid: true,
                      enableAxes: true,
                      enableLines: true,
                      enableSurfaces: true,
                      /* The view cube belongs to the tab; a card shows the canvas and two actions (E2). */
                      enableGizmo: !isInline,
                    }}
                    onComponentReference={setSelected}
                  />
                )}
                <div className='pointer-events-none absolute inset-x-0 top-0 flex flex-col items-start gap-1 p-2'>
                  {shown === undefined ? null : (
                    <p className='rounded-md bg-background/80 px-2 py-1 text-xs font-medium'>
                      {shown.model.title}
                      {selected === undefined ? null : (
                        <span className='text-muted-foreground'> · {selected.label}</span>
                      )}
                    </p>
                  )}
                  {shown === undefined ? null : <StatusLine state={state} />}
                </div>
                {notice === undefined ? null : (
                  <p
                    role='status'
                    className='absolute right-2 bottom-2 rounded-md border bg-popover px-2 py-1 text-xs shadow-xs'
                  >
                    {notice}
                  </p>
                )}
              </div>
              {isInline ? (
                <div className='flex items-center justify-end gap-1 border-t px-2 py-1'>{actions}</div>
              ) : (
                <div className='flex justify-center p-2'>
                  <ViewerBar actions={actions} />
                </div>
              )}
            </main>
          </GraphicsProvider>
        </TooltipProvider>
      </KeyboardProvider>
    </ViewerEnvironmentProvider>
  );
}
