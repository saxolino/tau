import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSelector } from '@xstate/react';
import { Check } from 'lucide-react';
import { messageRole } from '@taucad/chat/constants';
import type { MyMessagePart } from '@taucad/chat';
import { getActiveGroupValues } from '@taucad/types';
import { popoverSurfaceVariants } from '@taucad/ui/components/popover.variants';
import { cn } from '@taucad/ui/utils/cn';
import type { ModelAssembly, ModelAssemblyRun } from '@taucad/viewer/graphics/three/react/model-assembly';
import { useReducedMotion } from '#components/geometry/loader/metal-morph-playback-gates.js';
import { useChatContext, useChatSelector } from '#hooks/use-chat.js';
import type { CombinedChatState } from '#hooks/use-chat.js';
import { useParameterSetActor, useProject } from '#hooks/use-project.js';
import { useChatSidebarStatus } from '#hooks/use-sidebar-status.js';
import type { Language } from '#i18n/language.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import {
  assistantText,
  cantiereSteps,
  idleMontaggio,
  montaggioGraceMilliseconds,
  nextMontaggio,
  readFootprint,
} from '#lib/cantiere.js';
import type { CantiereStep, Footprint } from '#lib/cantiere.js';
import { pieceCaption, placeCallouts } from '#lib/montaggio.js';
import { selectChatActivityCue } from '#utils/chat-activity-cue.js';

/** Pause between two entering pieces. Milliseconds. */
const montaggioStepMilliseconds = 380;
/** How long the entered pieces stay named. Milliseconds. */
const montaggioHoldMilliseconds = 2200;
/** The fade that ends the names, inside the hold. Milliseconds. */
const montaggioFadeMilliseconds = 300;
/** Up to this many pieces each keep a name; a larger model names only the piece entering. */
const maximumNamedPieces = 5;
/** The steps shown at once; older ones scroll away. */
const maximumSteps = 5;

type ViewerAgentLayerProps = Readonly<{
  /** The viewer's assembly, armed here and played by the canvas. */
  assembly: ModelAssembly;
  entryPath: string;
  /** Whether the viewer draws a model. */
  isModelShown: boolean;
  /** Whether the latest build is known to have no piece. */
  isModelEmpty: boolean;
}>;

/**
 * The agent at work in the viewer, from what the turn already carries — no model call, no prompt, no wait. While it
 * builds a model from nothing, «Cantiere» lists its steps and draws the size its text announces; when the first
 * model arrives, «Montaggio» names the pieces as the canvas brings them in one at a time. Neither takes a click.
 *
 * @param props - The viewer's assembly, its entry and whether it draws a model or knows the model is empty.
 * @returns The layer, over the canvas and under the viewer's bar and status.
 */
export function ViewerAgentLayer({
  assembly,
  entryPath,
  isModelShown,
  isModelEmpty,
}: ViewerAgentLayerProps): React.JSX.Element {
  const { editorRef } = useProject();
  const chatId = useSelector(editorRef, (state) => state.context.focusedChatId);
  return (
    <>
      {/* The chat hooks need the active chat's provider, which mounts with a focused chat. */}
      {typeof chatId === 'string' ? (
        <AgentTurn assembly={assembly} isModelShown={isModelShown} isModelEmpty={isModelEmpty} />
      ) : null}
      <Montaggio assembly={assembly} entryPath={entryPath} />
    </>
  );
}

type AgentTurnFacts = Readonly<{
  status: CombinedChatState['status'];
  /** The request's message id: one per turn. */
  turnKey: string | undefined;
  imageAttached: boolean;
  /** The turn's assistant parts, once it has some. */
  parts: readonly MyMessagePart[] | undefined;
}>;

const selectAgentTurn = (state: CombinedChatState): AgentTurnFacts => {
  const trailing = state.messages.at(-1);
  const request = state.messages.findLast((message) => message.role === messageRole.user);
  return {
    status: state.status,
    turnKey: request?.id,
    imageAttached: request?.parts.some((part) => part.type === 'file' && part.mediaType.startsWith('image/')) ?? false,
    parts: trailing?.role === messageRole.assistant ? trailing.parts : undefined,
  };
};

/** Arms the viewer for the turn's first model and shows «Cantiere» while the turn builds one from nothing. */
function AgentTurn({
  assembly,
  isModelShown,
  isModelEmpty,
}: Omit<ViewerAgentLayerProps, 'entryPath'>): React.JSX.Element | undefined {
  const { projectId } = useProject();
  const { activeChatId } = useChatContext();
  const runState = useChatSidebarStatus(projectId, activeChatId)?.state;
  const turn = useChatSelector(selectAgentTurn);
  const isLive = selectChatActivityCue({ runState, chatStatus: turn.status }) !== undefined;
  const isReducedMotion = useReducedMotion();
  const playedKey = useSyncExternalStore(
    assembly.subscribe,
    () => assembly.getSnapshot().playedKey,
    () => undefined,
  );
  const armedKey = useSyncExternalStore(
    assembly.subscribe,
    () => assembly.getSnapshot().request?.key,
    () => undefined,
  );
  const memory = useRef(idleMontaggio);
  const { turnKey } = turn;

  useEffect(() => {
    const update = (): void => {
      memory.current = nextMontaggio(memory.current, { turnKey, isLive, isModelEmpty, playedKey, now: Date.now() });
      const key = memory.current.armedKey;
      assembly.arm(
        key === undefined
          ? undefined
          : {
              key,
              stepMilliseconds: isReducedMotion ? 0 : montaggioStepMilliseconds,
              holdMilliseconds: montaggioHoldMilliseconds,
            },
      );
    };
    update();
    if (isLive || memory.current.armedKey === undefined) {
      return undefined;
    }
    // A finished turn stays armed for a build that lands just after it, then lets go.
    const release = setTimeout(update, montaggioGraceMilliseconds + 100);
    return () => {
      clearTimeout(release);
    };
  }, [assembly, isLive, isModelEmpty, isReducedMotion, playedKey, turnKey]);

  const isBuilding = isLive && !isModelShown && turnKey !== undefined && (isModelEmpty || armedKey === turnKey);
  return isBuilding ? <Cantiere parts={turn.parts} imageAttached={turn.imageAttached} /> : undefined;
}

/**
 * «Cantiere»: the agent's steps, the last one pulsing while it runs, and the outline of the size its text announces.
 *
 * @param props - The turn's assistant parts and whether the request carries an image.
 * @returns The overlay.
 */
export function Cantiere({
  parts,
  imageAttached,
}: Readonly<{ parts: readonly MyMessagePart[] | undefined; imageAttached: boolean }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const steps = useMemo(() => cantiereSteps({ parts, isLive: true, imageAttached }), [parts, imageAttached]);
  const footprint = useMemo(() => readFootprint(assistantText(parts)), [parts]);
  const first = Math.max(0, steps.length - maximumSteps);
  return (
    <div aria-hidden='true' data-slot='viewer-cantiere' className='pointer-events-none absolute inset-0'>
      <ol className='absolute top-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded-md border bg-background/85 px-2.5 py-2 text-xs shadow-xs backdrop-blur-sm'>
        {steps.slice(first).map((step) => (
          <li key={step.id} data-state={step.state} className='flex min-w-0 items-center gap-2'>
            <StepMark state={step.state} />
            <span
              className={cn(
                'truncate',
                step.state === 'active'
                  ? 'animate-pulse text-foreground motion-reduce:animate-none'
                  : 'text-muted-foreground',
              )}
            >
              {t(`cantiere.steps.${step.kind}`)}
            </span>
          </li>
        ))}
      </ol>
      {footprint ? <FootprintOutline footprint={footprint} language={language} /> : null}
    </div>
  );
}

function StepMark({ state }: Readonly<{ state: CantiereStep['state'] }>): React.JSX.Element {
  return (
    <span className='flex size-3 shrink-0 items-center justify-center'>
      {state === 'done' ? (
        <Check aria-hidden='true' className='size-3 text-success' />
      ) : (
        <span
          className={cn(
            'size-1.5 rounded-full',
            state === 'active'
              ? 'animate-pulse bg-primary motion-reduce:animate-none'
              : 'border border-muted-foreground',
          )}
        />
      )}
    </span>
  );
}

/** Units of the outline's drawing: its longer side is this long. */
const outlineSpan = 100;
/** Distance of the dimension lines from the outline, in drawing units. */
const dimensionGap = 9;

/**
 * The announced size as a dashed outline with its two dimensions in millimetres, centred where the model will appear.
 *
 * @param props - The size and the interface language.
 * @returns The outline.
 */
function FootprintOutline({
  footprint,
  language,
}: Readonly<{ footprint: Footprint; language: Language }>): React.JSX.Element {
  const { t } = useTranslation();
  const longest = Math.max(footprint.width, footprint.height);
  const width = (footprint.width / longest) * outlineSpan;
  const height = (footprint.height / longest) * outlineSpan;
  const radius = Math.min(width, height) * 0.12;
  const below = height + dimensionGap;
  const beside = width + dimensionGap;
  const millimetres = (value: number): string =>
    t('cantiere.millimetres', { value: formatNumber(value, language, { maximumFractionDigits: 1 }) });
  return (
    <div className='absolute inset-0 flex items-center justify-center p-16'>
      <svg
        data-slot='viewer-cantiere-outline'
        viewBox={`-4 -4 ${beside + 34} ${below + 16}`}
        className='h-auto max-h-full w-[min(55%,22rem)] overflow-visible'
      >
        <rect
          width={width}
          height={height}
          rx={radius}
          className='fill-none stroke-muted-foreground'
          strokeWidth={1.2}
          strokeDasharray='5 4'
          vectorEffect='non-scaling-stroke'
        />
        <g className='fill-none stroke-primary' strokeWidth={1} vectorEffect='non-scaling-stroke'>
          <path
            vectorEffect='non-scaling-stroke'
            d={`M0 ${below - 3}V${below + 3}M${width} ${below - 3}V${below + 3}M0 ${below}H${width}`}
          />
          <path
            vectorEffect='non-scaling-stroke'
            d={`M${beside - 3} 0H${beside + 3}M${beside - 3} ${height}H${beside + 3}M${beside} 0V${height}`}
          />
        </g>
        <text x={width / 2} y={below + 9} textAnchor='middle' fontSize={6} className='fill-primary font-mono'>
          {millimetres(footprint.width)}
        </text>
        <text x={beside + 4} y={height / 2} dominantBaseline='middle' fontSize={6} className='fill-primary font-mono'>
          {millimetres(footprint.height)}
        </text>
      </svg>
    </div>
  );
}

/** «Montaggio»: while the canvas plays an assembly, the entering pieces' names and main measures. */
function Montaggio({
  assembly,
  entryPath,
}: Readonly<{ assembly: ModelAssembly; entryPath: string }>): React.JSX.Element | undefined {
  const run = useSyncExternalStore(
    assembly.subscribe,
    () => assembly.getSnapshot().run,
    () => undefined,
  );
  return run ? <MontaggioLabels run={run} entryPath={entryPath} /> : undefined;
}

/** A label's size, estimated from its text so labels never wait for a layout pass to make room. CSS pixels. */
const labelSize = (name: string, measure: string | undefined): { width: number; height: number } => ({
  width: Math.ceil(Math.max(name.length, measure?.length ?? 0) * 6.6) + 18,
  height: measure === undefined ? 26 : 42,
});

/**
 * The names of the pieces entering, beside each piece, and the count once all are in.
 *
 * @param props - The assembly being played and the viewer's entry, whose parameters give the main measures.
 * @returns The labels.
 */
export function MontaggioLabels({
  run,
  entryPath,
}: Readonly<{ run: ModelAssemblyRun; entryPath: string }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const { geometryUnits } = useProject();
  const parameterActor = useParameterSetActor(entryPath);
  const record = useSelector(parameterActor, (state) => state?.context.current?.entry);
  const parameters = useSelector(geometryUnits.get(entryPath), (state) => state?.context.parameterManifest);
  const defaults = parameters?.defaults ?? {};
  const values = getActiveGroupValues(record);
  const entered = run.componentIds.slice(0, run.entered);
  const named = run.componentIds.length <= maximumNamedPieces ? entered : entered.slice(-1);
  const labels = named.flatMap((componentId) => {
    const node = run.manifest.nodesById[componentId];
    const anchor = run.anchors[componentId];
    if (!node || !anchor) {
      return [];
    }
    const caption = pieceCaption({ node, manifest: run.manifest, defaults, values, language });
    return [{ id: componentId, caption, x: anchor.x, y: anchor.y, ...labelSize(caption.name, caption.measure) }];
  });
  const placed = run.canvas ? placeCallouts(labels, run.canvas) : [];
  const count = run.componentIds.length;
  return (
    <div
      aria-hidden='true'
      data-slot='viewer-montaggio'
      className={cn(
        'pointer-events-none absolute inset-0',
        run.isComplete && 'motion-safe:animate-out motion-safe:fade-out motion-safe:fill-mode-forwards',
      )}
      style={
        run.isComplete
          ? {
              animationDelay: `${montaggioHoldMilliseconds - montaggioFadeMilliseconds}ms`,
              animationDuration: `${montaggioFadeMilliseconds}ms`,
            }
          : undefined
      }
    >
      {placed.map(({ id, left, top }) => {
        const label = labels.find((candidate) => candidate.id === id);
        return label ? (
          <div
            key={id}
            data-slot='viewer-montaggio-label'
            className={cn(
              popoverSurfaceVariants(),
              'absolute flex max-w-56 flex-col px-2 py-1 text-xs',
              'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-300',
            )}
            style={{ left, top }}
          >
            <span className='truncate font-medium'>{label.caption.name}</span>
            {label.caption.measure === undefined ? null : (
              <span className='truncate text-muted-foreground tabular-nums'>{label.caption.measure}</span>
            )}
          </div>
        ) : null;
      })}
      {run.isComplete ? (
        <p className='absolute top-3 left-3 flex items-center gap-2 rounded-md border bg-background/85 px-2.5 py-1.5 text-xs shadow-xs backdrop-blur-sm'>
          <Check aria-hidden='true' className='size-3 text-success' />
          {t(count === 1 ? 'measures.onePiece' : 'measures.manyPieces', { count })}
        </p>
      ) : null}
    </div>
  );
}
