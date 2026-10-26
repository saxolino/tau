import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ChevronUp, Info, Pin, PinOff, Trash } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@taucad/ui/components/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@taucad/ui/components/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { AxisLabel } from '#cad/section-tool-row.jsx';
import { CopyButton } from '@taucad/ui/components/copy-button';
import { MeasureOperationIcon } from '#cad/measure-operation-icon.jsx';
import { useGraphics, useGraphicsSelector } from '#hooks/use-graphics.jsx';
import { useViewerLabels } from '#environment/viewer-environment.jsx';
import type { MeasurementLabels } from '#environment/viewer-environment.jsx';

const deltaAxes = [
  ['x', 0],
  ['y', 1],
  ['z', 2],
] as const;

const formatLength = (metres: number, metresPerUnit: number): string => {
  const value = metres / metresPerUnit;
  return value !== 0 && Math.abs(value) < 0.05 ? value.toPrecision(3) : value.toFixed(1);
};
const formatAngle = (radians: number): string => {
  const degrees = (radians * 180) / Math.PI;
  return degrees !== 0 && Math.abs(degrees) < 0.005 ? degrees.toPrecision(3) : degrees.toFixed(2);
};

/** Secondary source and accuracy evidence, available to hover, keyboard and touch. */
function MeasurementEvidence({
  quality,
  details,
  label,
}: Readonly<{
  quality: string;
  details?: string;
  label: string;
}>): React.JSX.Element {
  const m = useViewerLabels().measurement;
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          variant='ghost'
          size='icon-xs'
          aria-label={m.evidenceFor(label)}
          onClick={() => {
            setOpen(true);
          }}
        >
          <Info aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent className='max-w-64 break-words whitespace-normal'>
        {quality}: {details ?? m.noEvidence}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The measurements, pinned first and then newest first. Hovering or focusing a row previews it in the scene; each
 * row pins or removes its measurement.
 * @public
 */
export function MeasurementList({ onEmptied }: Readonly<{ onEmptied: () => void }>): React.JSX.Element {
  const labels = useViewerLabels();
  const m = labels.measurement;
  const graphicsRef = useGraphics();
  const measurements = useGraphicsSelector((state) => state.context.measurements);
  const hoveredId = useGraphicsSelector((state) => state.context.hoveredMeasurementId);
  const metersPerUnit = useGraphicsSelector((state) => state.context.displayUnits.length.metersPerUnit);
  const symbol = useGraphicsSelector((state) => state.context.displayUnits.length.symbol);
  const sorted = measurements
    .toReversed()
    .toSorted((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)));

  const hover = (id: string | undefined): void => {
    graphicsRef.send({ type: 'setHoveredMeasurement', payload: id });
  };

  const remove = (id: string, event: React.MouseEvent<HTMLButtonElement>): void => {
    const row = event.currentTarget.closest('li');
    const done = row
      ?.closest('[data-tool-bar]')
      ?.querySelector<HTMLButtonElement>(`[aria-label="${labels.doneWith(labels.measureLabel)}"]`);
    const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>(
      '[data-measurement-summary]',
    );
    flushSync(() => {
      graphicsRef.send({ type: 'clearMeasurement', payload: id });
    });
    if (neighbour) {
      neighbour.focus();
    } else {
      done?.focus();
      onEmptied();
    }
  };

  return (
    <ul aria-label={m.list} className='grid max-h-64 max-w-full min-w-0 gap-1 overflow-y-auto border-b pb-1'>
      {sorted.map((measurement) => {
        const value =
          measurement.operation === 'angle'
            ? `${formatAngle(measurement.distance)}°`
            : `${formatLength(measurement.distance, metersPerUnit)} ${symbol}`;
        const label =
          measurement.status === 'pending' ? m.resolving : measurement.status === 'unavailable' ? m.unavailable : value;
        const operation = measurement.operation ?? 'point-distance';
        const name = measurement.name?.trim();
        return (
          <li
            key={measurement.id}
            data-hovered={hoveredId === measurement.id}
            className='min-w-0 rounded-md data-[hovered=true]:bg-accent'
            onPointerEnter={() => {
              hover(measurement.id);
            }}
            onPointerLeave={() => {
              hover(undefined);
            }}
            // Keyboard focus previews the measurement as hover does; the focus a pointer-opened list lands with does not.
            onFocus={(event) => {
              if (event.target.matches(':focus-visible')) {
                hover(measurement.id);
              }
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                hover(undefined);
              }
            }}
          >
            <Collapsible>
              <CollapsibleTrigger
                data-measurement-summary=''
                className='group/measurement flex min-h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent'
                aria-label={m.summary(m.operations[operation], label, measurement.status === 'out-of-date')}
              >
                <MeasureOperationIcon operation={operation} aria-hidden className='size-4 shrink-0' />
                <span className='min-w-0 flex-1 truncate tabular-nums'>{label}</span>
                {measurement.status === 'out-of-date' ? (
                  <span className='text-xs text-muted-foreground'>{m.outOfDate}</span>
                ) : null}
                <ChevronUp
                  aria-hidden
                  className='size-3 shrink-0 rotate-180 text-muted-foreground group-data-[state=open]/measurement:rotate-0'
                />
              </CollapsibleTrigger>
              <CollapsibleContent className='min-w-0 px-2 pb-1 text-xs text-muted-foreground'>
                <div className='flex min-w-0 flex-wrap items-center gap-1'>
                  <span className='mr-auto min-w-0 break-words'>{m.operations[operation]}</span>
                  {name ? <span className='min-w-0 break-words'>{name}</span> : null}
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    aria-label={m.pin(label)}
                    aria-pressed={Boolean(measurement.isPinned)}
                    className={measurement.isPinned ? 'text-foreground' : 'text-muted-foreground'}
                    onClick={() => {
                      graphicsRef.send({
                        type: 'toggleMeasurementPinned',
                        id: measurement.id,
                      });
                    }}
                  >
                    {measurement.isPinned ? <Pin /> : <PinOff />}
                  </Button>
                  <CopyButton
                    size='icon-xs'
                    tooltip={m.copyFull(label)}
                    aria-label={m.copyFull(label)}
                    disabled={measurement.status === 'pending' || measurement.status === 'unavailable'}
                    getText={() =>
                      measurement.operation === 'angle'
                        ? `${(measurement.distance * 180) / Math.PI}°`
                        : `${measurement.distance / metersPerUnit} ${symbol}`
                    }
                  />
                  <Button
                    variant='ghost'
                    size='icon-xs'
                    aria-label={m.remove(label)}
                    className='text-muted-foreground hover:text-destructive'
                    onClick={(event) => {
                      remove(measurement.id, event);
                    }}
                  >
                    <Trash />
                  </Button>
                </div>
                <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 tabular-nums'>
                  {measurement.status === 'pending' ? <span>{m.pending}</span> : null}
                  {measurement.status === 'unavailable' ? <span>{m.unavailable}</span> : null}
                  {measurement.unavailableReason ? (
                    <span className='break-words'>{measurement.unavailableReason}</span>
                  ) : null}
                  {measurement.anchors?.[0]?.label ? (
                    <span className='break-words'>{measurement.anchors[0].label}</span>
                  ) : null}
                  {deltaAxes.map(([axis, index]) => (
                    <span key={axis}>
                      <AxisLabel axis={axis} />{' '}
                      {formatLength(
                        measurement.frameBasis
                          ? measurement.frameBasis[index][0] * (measurement.endPoint[0] - measurement.startPoint[0]) +
                              measurement.frameBasis[index][1] * (measurement.endPoint[1] - measurement.startPoint[1]) +
                              measurement.frameBasis[index][2] * (measurement.endPoint[2] - measurement.startPoint[2])
                          : measurement.endPoint[index] - measurement.startPoint[index],
                        metersPerUnit,
                      )}
                    </span>
                  ))}
                  <span>{measurement.frameId === 'tau:root' ? m.rootFrame : m.featureFrame}</span>
                  <MeasurementEvidence
                    quality={m.qualities[measurement.quality ?? 'snapshot']}
                    details={measurement.evidenceDetails}
                    label={label}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </li>
        );
      })}
    </ul>
  );
}

const countLabelOf = (count: number, mode: 'auto' | 'point', m: MeasurementLabels): string =>
  count === 0 ? (mode === 'auto' ? m.chooseHint : m.clickTwoPoints) : m.count(count);

/**
 * The Measuring row's options: the count, which expands the inline list, and Clear all. A polite live region
 * announces the count as it changes.
 * @public
 */
export function MeasureOptions({
  expanded,
  onExpandedChange,
}: Readonly<{
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}>): React.JSX.Element {
  const m = useViewerLabels().measurement;
  const graphicsRef = useGraphics();
  const count = useGraphicsSelector((state) => state.context.measurements.length);
  const mode = useGraphicsSelector((state) => state.context.measureMode);
  const snapEnabled = useGraphicsSelector((state) => state.context.measureSnapEnabled);
  const filter = useGraphicsSelector((state) => state.context.measureFilter);
  const operation = useGraphicsSelector((state) => state.context.measureOperation);
  const frame = useGraphicsSelector((state) => state.context.measureFrame);
  const candidates = useGraphicsSelector((state) => state.context.measureCandidates);
  const catalogHasMore = useGraphicsSelector((state) => state.context.measureCatalogHasMore);
  const activeCandidateId = useGraphicsSelector((state) => state.context.measureActiveCandidateId);
  const lockedTargetId = useGraphicsSelector((state) => state.context.measureLockedTargetId);
  const message = useGraphicsSelector((state) => state.context.measureMessage);
  const previewDistance = useGraphicsSelector((state) => state.context.measurePreviewDistance);
  const previewMetersPerUnit = useGraphicsSelector((state) => state.context.displayUnits.length.metersPerUnit);
  const previewSymbol = useGraphicsSelector((state) => state.context.displayUnits.length.symbol);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const catalogRequestedRef = useRef(false);
  const countLabel = countLabelOf(count, mode, m);
  const activeLabel = candidates.find((candidate) => candidate.id === activeCandidateId)?.label;

  // With nothing left to list or clear, the row's next control is Done.
  const focusRow = (): void => {
    const buttons = anchorRef.current
      ?.closest('[data-tool-bar]')
      ?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (buttons && buttons.length > 0) {
      buttons.item(buttons.length - 1).focus();
    }
  };

  return (
    <div className='flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5'>
      <Popover
        onOpenChange={(open) => {
          if (!open) {
            catalogRequestedRef.current = false;
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button variant='ghost' size='xs' className='max-w-40 truncate'>
            {m.targets(
              mode === 'auto' ? m.modeAuto : m.modePoints,
              filter === 'auto' ? m.filterAll : m.filters[filter],
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side='top'
          align='start'
          className='w-72 max-w-[calc(100vw-2rem)] p-3'
          aria-label={m.targetsName}
        >
          <div className='grid gap-2'>
            <label className='text-xs'>
              {m.mode}
              <select
                className='mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:focus-outline'
                aria-label={m.modeName}
                value={mode}
                onChange={(event) => {
                  graphicsRef.send({
                    type: 'setMeasureMode',
                    mode: event.target.value as typeof mode,
                  });
                  if (catalogRequestedRef.current) {
                    graphicsRef.send({ type: 'requestMeasureCatalog' });
                  }
                }}
              >
                <option value='auto'>{m.modeAuto}</option>
                <option value='point'>{m.modePoints}</option>
              </select>
            </label>
            <Button
              variant='outline'
              size='sm'
              aria-label={snapEnabled ? m.snapTurnOff : m.snapTurnOn}
              aria-pressed={!snapEnabled}
              onClick={() => {
                graphicsRef.send({
                  type: 'setMeasureSnapEnabled',
                  enabled: !snapEnabled,
                });
              }}
            >
              {snapEnabled ? m.snapOn : m.snapOff}
            </Button>
            <label className='text-xs'>
              {m.filter}
              <select
                className='mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:focus-outline'
                aria-label={m.filterName}
                value={filter}
                onChange={(event) => {
                  graphicsRef.send({
                    type: 'setMeasureFilter',
                    filter: event.target.value as typeof filter,
                  });
                  if (catalogRequestedRef.current) {
                    graphicsRef.send({ type: 'requestMeasureCatalog' });
                  }
                }}
              >
                <option value='auto'>{m.filterAll}</option>
                {(['point', 'edge', 'face', 'circle', 'body'] as const).map((kind) => (
                  <option key={kind} value={kind}>
                    {m.filters[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className='text-xs'>
              {m.operation}
              <select
                className='mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:focus-outline'
                aria-label={m.operationName}
                value={operation}
                onChange={(event) => {
                  graphicsRef.send({
                    type: 'setMeasureOperation',
                    operation: event.target.value as typeof operation,
                  });
                }}
              >
                {(Object.keys(m.operations) as Array<keyof typeof m.operations>).map((kind) => (
                  <option key={kind} value={kind}>
                    {m.operations[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className='text-xs'>
              {m.frame}
              <select
                className='mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:focus-outline'
                aria-label={m.frameName}
                value={frame}
                onChange={(event) => {
                  graphicsRef.send({
                    type: 'setMeasureFrame',
                    frame: event.target.value as typeof frame,
                  });
                }}
              >
                <option value='tau:root'>{m.frameRoot}</option>
                <option value='selected-local'>{m.frameLocal}</option>
              </select>
            </label>
            <label className='text-xs'>
              {m.chooseTarget}
              <select
                className='mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:focus-outline'
                aria-label={m.chooseTarget}
                value={activeCandidateId ?? ''}
                onFocus={() => {
                  if (!catalogRequestedRef.current) {
                    catalogRequestedRef.current = true;
                    graphicsRef.send({ type: 'requestMeasureCatalog' });
                  }
                }}
                onChange={(event) => {
                  graphicsRef.send({
                    type: 'chooseMeasureCandidate',
                    id: event.target.value,
                  });
                }}
              >
                <option value=''>{m.selectTarget}</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
            {catalogHasMore && (
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  graphicsRef.send({
                    type: 'requestMeasureCatalog',
                    append: true,
                  });
                }}
              >
                {m.loadMore}
              </Button>
            )}
            <Button
              variant='outline'
              size='sm'
              disabled={!activeCandidateId}
              onClick={() => {
                graphicsRef.send({
                  type: 'setMeasureLockedTarget',
                  id: lockedTargetId ? undefined : activeCandidateId,
                });
              }}
              aria-pressed={Boolean(lockedTargetId)}
            >
              {lockedTargetId ? m.unlock : m.lock}
            </Button>
            <Button
              variant='default'
              size='sm'
              disabled={!activeCandidateId}
              onClick={() => {
                graphicsRef.send({ type: 'requestMeasureCandidateCommit' });
              }}
            >
              {m.useTarget}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <span ref={anchorRef} role='status' className='sr-only'>
        {countLabel}
      </span>
      {count === 0 ? (
        <span aria-hidden='true' className='px-1 text-xs text-muted-foreground'>
          {countLabel}
        </span>
      ) : (
        <Button
          variant='ghost'
          size='xs'
          className='gap-1 tabular-nums'
          aria-expanded={expanded}
          onClick={(event) => {
            const next = !expanded;
            flushSync(() => {
              onExpandedChange(next);
            });
            if (next) {
              event.currentTarget
                .closest('[data-tool-bar]')
                ?.querySelector<HTMLElement>('[data-measurement-summary]')
                ?.focus();
            }
          }}
        >
          {countLabel}
          <ChevronUp aria-hidden className={`size-3 text-muted-foreground ${expanded ? '' : 'rotate-180'}`} />
        </Button>
      )}
      <Button
        variant='ghost'
        size='xs'
        className=''
        disabled={count === 0}
        onClick={() => {
          flushSync(() => {
            graphicsRef.send({ type: 'clearAllMeasurements' });
          });
          onExpandedChange(false);
          focusRow();
        }}
      >
        {m.clearAll}
      </Button>
      {activeLabel !== undefined || message !== undefined || previewDistance !== undefined ? (
        <div className='order-last flex min-w-0 basis-full items-center gap-2 text-xs text-muted-foreground'>
          {activeLabel ? (
            <span className='min-w-0 flex-1 truncate' title={activeLabel}>
              {lockedTargetId ? m.locked : ''}
              {activeLabel}
            </span>
          ) : null}
          {message ? (
            <span role='status' className='min-w-0 flex-1 truncate' title={message}>
              {message}
            </span>
          ) : null}
          {previewDistance === undefined ? null : (
            <output aria-label={m.previewName} className='shrink-0 tabular-nums'>
              {formatLength(previewDistance, previewMetersPerUnit)} {previewSymbol}
            </output>
          )}
        </div>
      ) : null}
    </div>
  );
}
