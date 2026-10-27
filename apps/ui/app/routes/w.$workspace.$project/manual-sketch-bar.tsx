import { Circle, PenTool, RectangleHorizontal, RulerDimensionLine, Spline } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import type { ManualSketchControls } from '#hooks/use-manual-sketch-tool.js';
import type { SketchToolKind } from '#services/manual-sketch.js';

type IconProps = Readonly<{ className?: string }>;
const strokeProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
/** A straight segment between two points. */
const LineIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...strokeProps} aria-hidden className={className}>
    <path d='M5 19 19 5' />
    <circle cx='5' cy='19' r='1.5' fill='currentColor' />
    <circle cx='19' cy='5' r='1.5' fill='currentColor' />
  </svg>
);
/** An arc through three points. */
const ArcIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...strokeProps} aria-hidden className={className}>
    <path d='M4 18a8 8 0 0 1 16 0' />
    <circle cx='4' cy='18' r='1.5' fill='currentColor' />
    <circle cx='12' cy='10' r='1.5' fill='currentColor' />
    <circle cx='20' cy='18' r='1.5' fill='currentColor' />
  </svg>
);
/** A line continued by an arc leaving along it. */
const TangentArcIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...strokeProps} aria-hidden className={className}>
    <path d='M3 18h9a6 6 0 0 0 6-6V5' />
    <circle cx='12' cy='18' r='1.5' fill='currentColor' />
  </svg>
);

const toolIcons: Record<SketchToolKind, (props: IconProps) => React.JSX.Element> = {
  line: LineIcon,
  arc: ArcIcon,
  tangentArc: TangentArcIcon,
  circle: (props) => <Circle aria-hidden {...props} />,
  rectangle: (props) => <RectangleHorizontal aria-hidden {...props} />,
  spline: (props) => <Spline aria-hidden {...props} />,
};
const toolKeys: Record<SketchToolKind, string> = {
  line: 'L',
  arc: 'A',
  tangentArc: 'A A',
  circle: 'C',
  rectangle: 'R',
  spline: 'S',
};
const toolOrder: readonly SketchToolKind[] = ['line', 'arc', 'tangentArc', 'circle', 'rectangle', 'spline'];

const Hairline = (): React.JSX.Element => <span aria-hidden className='mx-1 h-4 w-px shrink-0 bg-border' />;

/** The hint for the gesture under way, from the tool and how many points it has. */
function hintKey(controls: ManualSketchControls): PlainMessageKey {
  const { drawing, stage } = controls;
  if (stage === 'pickEdge') {
    return 'sketch.hints.pickEdge';
  }
  if (!drawing) {
    return 'sketch.choosePlane';
  }
  const placed = drawing.clicks.length;
  switch (drawing.tool) {
    case 'arc': {
      return placed === 0 ? 'sketch.hints.arc0' : placed === 1 ? 'sketch.hints.arc1' : 'sketch.hints.arc2';
    }
    case 'line':
    case 'tangentArc':
    case 'circle':
    case 'rectangle':
    case 'spline': {
      return `sketch.hints.${drawing.tool}${placed === 0 ? 0 : 1}` as const;
    }
  }
}

/**
 * The sketch's row in the viewer's bar, above its controls as Section's and Measure's rows are: the plane, the
 * drawing tools with their keys, the corner radius of the rectangle, and Esci; above it the hint of the gesture under
 * way and what the pointer snaps to, spoken politely. While the sweep path is drawn, Fine percorso closes the row.
 */
export function ManualSketchBar({ controls }: Readonly<{ controls: ManualSketchControls }>): React.ReactNode {
  const { t } = useTranslation();
  if (!controls.active) {
    return null;
  }
  const { drawing, plane, stage } = controls;
  const title = controls.isPath
    ? t('sketch.drawingPath')
    : plane
      ? plane.piece
        ? t('sketch.onPiece', { plane: plane.label, piece: plane.piece })
        : t('sketch.on', { plane: plane.label })
      : t('sketch.title');
  const snap = drawing?.hover?.kind;
  const notice = drawing?.notice ? t(`sketch.notices.${drawing.notice}`) : undefined;
  const status = [snap && snap !== 'free' ? t('sketch.snapTo', { snap: t(`sketch.snap.${snap}`) }) : undefined].filter(
    Boolean,
  );
  return (
    <div
      role='group'
      aria-label={t('sketch.toolbar')}
      data-tool-bar='sketch'
      className='flex max-w-full flex-col gap-1 border-b pb-1'
    >
      <p role='status' className='flex min-w-0 flex-wrap items-center gap-x-2 px-1 text-xs text-muted-foreground'>
        <span className={cn('min-w-0', notice && 'text-foreground')}>{notice ?? t(hintKey(controls))}</span>
        {status.length > 0 ? (
          <span className='font-mono text-titanium-foreground tabular-nums'>{status.join(' · ')}</span>
        ) : null}
      </p>
      <div className='flex min-h-7 flex-wrap items-center gap-1'>
        <span className='flex min-w-0 shrink items-center gap-1 px-1 text-xs font-medium'>
          <PenTool aria-hidden className='size-4 shrink-0 text-titanium-foreground' />
          <span className='hidden truncate @min-[520px]/viewer:inline'>{title}</span>
        </span>
        <Hairline />
        {stage === 'plane' ? (
          <>
            <span className='px-1 text-xs text-muted-foreground'>{t('sketch.basePlanes')}</span>
            {(['xy', 'xz', 'yz'] as const).map((name) => (
              <Button
                key={name}
                size='xs'
                variant='ghost'
                className='h-7 font-mono'
                onClick={() => {
                  controls.onBasePlane(name);
                }}
              >
                {name.toUpperCase()}
              </Button>
            ))}
          </>
        ) : (
          <>
            {toolOrder.map((tool) => {
              const Icon = toolIcons[tool];
              const isPressed = drawing?.tool === tool;
              return (
                <Tooltip key={tool}>
                  <TooltipTrigger asChild>
                    <Button
                      size='icon-sm'
                      variant='ghost'
                      aria-label={t(`sketch.tools.${tool}`)}
                      aria-pressed={isPressed}
                      aria-keyshortcuts={toolKeys[tool].split(' ')[0]}
                      disabled={stage === 'pickEdge'}
                      className={cn(
                        'size-7 border border-transparent',
                        isPressed && 'border-titanium bg-titanium/15 text-foreground hover:bg-titanium/25',
                      )}
                      onClick={() => {
                        controls.onTool(tool);
                      }}
                    >
                      <Icon className='size-4' />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t(`sketch.tools.${tool}`)} <KeyShortcut variant='tooltip'>{toolKeys[tool]}</KeyShortcut>
                  </TooltipContent>
                </Tooltip>
              );
            })}
            {drawing?.tool === 'rectangle' ? (
              <label className='flex items-center gap-1 px-1 text-xs text-muted-foreground'>
                <span className='hidden @min-[640px]/viewer:inline'>{t('sketch.cornerRadius')}</span>
                <input
                  type='number'
                  min={0}
                  step={0.1}
                  inputMode='decimal'
                  aria-label={t('sketch.cornerRadius')}
                  value={drawing.cornerRadius}
                  className='h-6 w-14 rounded-md border bg-background px-1.5 font-mono text-xs text-foreground tabular-nums focus-visible:focus-outline'
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) {
                      controls.onCornerRadius(next);
                    }
                  }}
                />
                <span aria-hidden>mm</span>
              </label>
            ) : null}
            <Hairline />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size='icon-sm'
                  variant='ghost'
                  className='size-7'
                  aria-label={t('sketch.tools.quota')}
                  aria-keyshortcuts='D'
                  disabled={!controls.liveQuota}
                  onClick={controls.onQuotaOpen}
                >
                  <RulerDimensionLine aria-hidden className='size-4' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('sketch.tools.quota')} <KeyShortcut variant='tooltip'>D</KeyShortcut>
              </TooltipContent>
            </Tooltip>
            {controls.isPath ? (
              <>
                <Hairline />
                {(['alongX', 'alongY'] as const).map((along) => (
                  <Button
                    key={along}
                    size='xs'
                    variant='ghost'
                    className='h-7'
                    aria-pressed={plane?.label === along}
                    onClick={() => {
                      controls.onPathPlane(along);
                    }}
                  >
                    {t(`sketch.pathPlanes.${along}`)}
                  </Button>
                ))}
              </>
            ) : null}
          </>
        )}
        <span className='min-w-0 flex-1' />
        {controls.isPath ? (
          <Button size='xs' variant='secondary' className='h-7' onClick={controls.onPathDone}>
            {t('sketch.pathDone')}
          </Button>
        ) : (
          <Button size='xs' variant='secondary' className='h-7' aria-keyshortcuts='Escape' onClick={controls.onExit}>
            {t('sketch.exit')}
            <KeyShortcut variant='ghost'>Esc</KeyShortcut>
          </Button>
        )}
      </div>
    </div>
  );
}
