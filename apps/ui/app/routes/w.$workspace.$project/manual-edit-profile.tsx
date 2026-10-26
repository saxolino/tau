import { randomUuid } from '@taucad/utils/id';
import { useId, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { isManualProfileClosed, offsetManualProfile } from '@taucad/smlib/manual-operations';
import type { ManualPointProfile, ManualProfile } from '@taucad/smlib/manual-operations';
import { Button } from '@taucad/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';
import {
  manualProfileBounds,
  manualProfilePath,
  resizeManualSegment,
  snapManualProfilePoint,
} from '#services/manual-profile-editor.js';
import type { ManualProfileSnap } from '#services/manual-profile-editor.js';
import { ManualChoice, ManualNumberField } from '#routes/w.$workspace.$project/manual-edit-fields.js';

type Point = ManualPointProfile['points'][number];
const snapMessages = {
  endpoint: 'manualEdit.snapEndpoint',
  midpoint: 'manualEdit.snapMidpoint',
  axis: 'manualEdit.snapAxis',
  grid: 'manualEdit.snapGrid',
} as const;

/** Pointer, touch, dimensions and keyboard all edit the same canonical profile geometry. */
export function ManualProfileEditor({
  profile,
  onChange,
}: Readonly<{ profile: ManualProfile; onChange: (profile: ManualProfile) => void }>): React.JSX.Element {
  const { t } = useTranslation();
  const patternId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; pointerId: number; before: ManualProfile } | undefined>(undefined);
  const pointProfile = profile.kind === 'polygon' || profile.kind === 'spline' ? profile : undefined;
  const [selectedId, setSelectedId] = useState(pointProfile?.points[0]?.id);
  const [bounds, setBounds] = useState(() => manualProfileBounds(profile));
  const [isAdding, setIsAdding] = useState(false);
  const [hasSnap, setHasSnap] = useState(true);
  const [snapKind, setSnapKind] = useState<ManualProfileSnap['kind']>();
  const [grid, setGrid] = useState(1);
  const [offset, setOffset] = useState(1);
  const [offsetError, setOffsetError] = useState<string>();
  const selected = pointProfile?.points.find((point) => point.id === selectedId) ?? pointProfile?.points[0];
  const selectedIndex = pointProfile?.points.findIndex((point) => point.id === selected?.id) ?? -1;
  const next =
    pointProfile &&
    selectedIndex >= 0 &&
    (isManualProfileClosed(profile) || selectedIndex < pointProfile.points.length - 1)
      ? pointProfile.points[(selectedIndex + 1) % pointProfile.points.length]
      : undefined;
  const segmentLength = selected && next ? Math.hypot(next.x - selected.x, next.y - selected.y) : undefined;
  const update = (id: string, changes: Partial<Pick<Point, 'x' | 'y'>>): void => {
    if (pointProfile) {
      onChange({
        ...pointProfile,
        points: pointProfile.points.map((point) => (point.id === id ? { ...point, ...changes } : point)),
      });
    }
  };
  const append = (x: number, y: number): void => {
    if (!pointProfile || pointProfile.points.length >= 256) {
      return;
    }
    const point = { id: randomUuid(), x, y };
    const points = [...pointProfile.points];
    points.splice(selectedIndex >= 0 ? selectedIndex + 1 : points.length, 0, point);
    onChange({ ...pointProfile, points });
    setSelectedId(point.id);
  };
  const minimumPoints = isManualProfileClosed(profile) ? 3 : 2;
  const coordinates = (event: React.PointerEvent<SVGElement>): { x: number; y: number } | undefined => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) {
      return undefined;
    }
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const point = { x: local.x, y: -local.y };
    if (!hasSnap || !pointProfile) {
      setSnapKind(undefined);
      return point;
    }
    const result = snapManualProfilePoint({
      profile: pointProfile,
      point,
      excludeId: drag.current?.id,
      tolerance: 8 / Math.hypot(matrix.a, matrix.b),
      grid,
    });
    setSnapKind(result.kind);
    return result.point;
  };
  const changeKind = (kind: string): void => {
    const placement = { plane: profile.plane, origin: profile.origin };
    let changed: ManualProfile;
    if (kind === 'circle' || kind === 'arc') {
      const analytic = profile.kind === 'circle' || profile.kind === 'arc' ? profile : undefined;
      const center = analytic?.center ?? { x: 0, y: 0 };
      const radius = analytic?.radius ?? 10;
      changed =
        kind === 'circle'
          ? { ...placement, kind, center, radius }
          : { ...placement, kind, center, radius, startAngle: 0, sweepAngle: 90 };
    } else if (kind === 'polygon' || kind === 'spline') {
      changed = pointProfile
        ? { ...pointProfile, kind }
        : {
            ...placement,
            kind,
            points: [
              { id: randomUuid(), x: -10, y: -10 },
              { id: randomUuid(), x: 10, y: -10 },
              { id: randomUuid(), x: 10, y: 10 },
              { id: randomUuid(), x: -10, y: 10 },
            ],
          };
    } else {
      return;
    }
    onChange(changed);
    setBounds(manualProfileBounds(changed));
    setOffsetError(undefined);
    setSnapKind(undefined);
  };
  return (
    <section className='@container space-y-4' aria-label={t('manualEdit.profile')}>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap gap-1'>
          {pointProfile ? (
            <>
              <Button
                size='sm'
                variant={isAdding ? 'ghost' : 'secondary'}
                aria-pressed={!isAdding}
                onClick={() => {
                  setIsAdding(false);
                }}
              >
                {t('manualEdit.movePoints')}
              </Button>
              <Button
                size='sm'
                variant={isAdding ? 'secondary' : 'ghost'}
                aria-pressed={isAdding}
                onClick={() => {
                  setIsAdding(true);
                }}
              >
                {t('manualEdit.addPoints')}
              </Button>
            </>
          ) : null}
        </div>
        <Button
          size='sm'
          variant='ghost'
          onClick={() => {
            setBounds(manualProfileBounds(profile));
          }}
        >
          {t('manualEdit.fit')}
        </Button>
      </div>
      <div className='grid items-start gap-4 @min-[28rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]'>
        <div className='min-w-0 space-y-2'>
          <svg
            ref={svg}
            role='group'
            aria-label={t('manualEdit.drawing')}
            viewBox={`${bounds.x} ${bounds.y} ${bounds.span} ${bounds.span}`}
            className='aspect-square w-full touch-none rounded-md border border-border bg-muted/20'
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                if (drag.current) {
                  onChange(drag.current.before);
                }
                drag.current = undefined;
                setIsAdding(false);
                setSnapKind(undefined);
              }
            }}
            onPointerDown={(event) => {
              if (isAdding && event.button === 0) {
                const point = coordinates(event);
                if (point) {
                  append(point.x, point.y);
                }
              }
            }}
            onPointerMove={(event) => {
              if (drag.current?.pointerId === event.pointerId) {
                const point = coordinates(event);
                if (point) {
                  update(drag.current.id, point);
                }
              }
            }}
            onPointerUp={() => {
              drag.current = undefined;
              setSnapKind(undefined);
            }}
            onPointerCancel={() => {
              if (drag.current) {
                onChange(drag.current.before);
              }
              drag.current = undefined;
              setSnapKind(undefined);
            }}
          >
            <defs>
              <pattern
                id={patternId}
                width={Math.max(grid, bounds.span / 60)}
                height={Math.max(grid, bounds.span / 60)}
                patternUnits='userSpaceOnUse'
              >
                <path
                  d={`M ${Math.max(grid, bounds.span / 60)} 0 H 0 V ${Math.max(grid, bounds.span / 60)}`}
                  fill='none'
                  className='stroke-border'
                  strokeWidth={bounds.span / 600}
                />
              </pattern>
            </defs>
            <rect x={bounds.x} y={bounds.y} width={bounds.span} height={bounds.span} fill={`url(#${patternId})`} />
            <path
              data-testid='manual-profile-path'
              d={manualProfilePath(profile)}
              className={cn('stroke-foreground', isManualProfileClosed(profile) ? 'fill-accent' : 'fill-none')}
              strokeWidth={bounds.span / 250}
            />
            {pointProfile?.points.map((point, index) => (
              <circle
                key={point.id}
                role='button'
                tabIndex={0}
                aria-label={t('manualEdit.point', { number: index + 1 })}
                aria-pressed={point.id === selected?.id}
                cx={point.x}
                cy={-point.y}
                r={bounds.span / 25}
                strokeWidth={bounds.span / 250}
                className={cn(
                  'cursor-move stroke-foreground outline-none focus-visible:stroke-primary',
                  point.id === selected?.id ? 'fill-primary' : 'fill-background',
                )}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (event.button === 0) {
                    setSelectedId(point.id);
                    event.currentTarget.focus();
                    drag.current = { id: point.id, pointerId: event.pointerId, before: profile };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }
                }}
                onKeyDown={(event) => {
                  const movement = event.shiftKey ? grid * 10 : grid;
                  const keys: Record<string, { x: number; y: number }> = {
                    ArrowLeft: { x: -movement, y: 0 },
                    ArrowRight: { x: movement, y: 0 },
                    ArrowUp: { x: 0, y: movement },
                    ArrowDown: { x: 0, y: -movement },
                  };
                  const delta = keys[event.key];
                  if (delta) {
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedId(point.id);
                    update(point.id, { x: point.x + delta.x, y: point.y + delta.y });
                  }
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedId(point.id);
                  }
                }}
              />
            ))}
          </svg>
          {snapKind ? (
            <p role='status' className='text-xs'>
              {t(snapMessages[snapKind])}
            </p>
          ) : null}
          <p className='text-xs text-muted-foreground'>
            {t(pointProfile ? 'manualEdit.profileHelp' : 'manualEdit.analyticProfileHelp')}
          </p>
        </div>
        <div className='min-w-0 space-y-3'>
          {pointProfile ? (
            selected ? (
              <fieldset className='space-y-2'>
                <legend className='mb-2 text-sm font-medium'>
                  {t('manualEdit.selectedPoint')} · {selectedIndex + 1}
                </legend>
                <ManualNumberField
                  label='X'
                  value={selected.x}
                  onChange={(x) => {
                    update(selected.id, { x });
                  }}
                />
                <ManualNumberField
                  label='Y'
                  value={selected.y}
                  onChange={(y) => {
                    update(selected.id, { y });
                  }}
                />
                {segmentLength !== undefined && next ? (
                  <>
                    <ManualNumberField
                      label={t('manualEdit.segmentLength')}
                      value={segmentLength}
                      min={0.001}
                      onChange={(length) => {
                        onChange(resizeManualSegment(pointProfile, selectedIndex, { length }));
                      }}
                    />
                    <ManualNumberField
                      label={t('manualEdit.segmentAngle')}
                      value={(Math.atan2(next.y - selected.y, next.x - selected.x) * 180) / Math.PI}
                      unit='°'
                      step={1}
                      onChange={(angle) => {
                        onChange(resizeManualSegment(pointProfile, selectedIndex, { length: segmentLength, angle }));
                      }}
                    />
                    {profile.kind === 'spline' ? (
                      <p className='text-xs text-muted-foreground'>{t('manualEdit.splineDimensionHelp')}</p>
                    ) : null}
                  </>
                ) : null}
                <div className='flex gap-1'>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size='icon-sm'
                        variant='outline'
                        aria-label={t('manualEdit.addPoint')}
                        disabled={pointProfile.points.length >= 256}
                        onClick={() => {
                          append(
                            next ? (selected.x + next.x) / 2 : selected.x + grid,
                            next ? (selected.y + next.y) / 2 : selected.y,
                          );
                        }}
                      >
                        <Plus />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('manualEdit.addPoint')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size='icon-sm'
                        variant='ghost'
                        aria-label={t('manualEdit.removePoint')}
                        disabled={pointProfile.points.length <= minimumPoints}
                        onClick={() => {
                          onChange({
                            ...pointProfile,
                            points: pointProfile.points.filter((point) => point.id !== selected.id),
                          });
                          setSelectedId(pointProfile.points.find((point) => point.id !== selected.id)?.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('manualEdit.removePoint')}</TooltipContent>
                  </Tooltip>
                </div>
                <p className='text-xs text-muted-foreground'>{t('manualEdit.pointHelp')}</p>
              </fieldset>
            ) : null
          ) : profile.kind === 'circle' || profile.kind === 'arc' ? (
            <>
              <ManualNumberField
                label={t('manualEdit.centerX')}
                value={profile.center.x}
                onChange={(x) => {
                  onChange({ ...profile, center: { ...profile.center, x } });
                }}
              />
              <ManualNumberField
                label={t('manualEdit.centerY')}
                value={profile.center.y}
                onChange={(y) => {
                  onChange({ ...profile, center: { ...profile.center, y } });
                }}
              />
              <ManualNumberField
                label={t('manualEdit.radius')}
                value={profile.radius}
                min={0.001}
                onChange={(radius) => {
                  onChange({ ...profile, radius });
                }}
              />
              {profile.kind === 'arc' ? (
                <>
                  <ManualNumberField
                    label={t('manualEdit.startAngle')}
                    value={profile.startAngle}
                    unit='°'
                    step={1}
                    onChange={(startAngle) => {
                      onChange({ ...profile, startAngle });
                    }}
                  />
                  <ManualNumberField
                    label={t('manualEdit.sweepAngle')}
                    value={profile.sweepAngle}
                    unit='°'
                    step={1}
                    min={-359.999}
                    max={359.999}
                    onChange={(sweepAngle) => {
                      onChange({ ...profile, sweepAngle });
                    }}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <ManualChoice
        label={t('manualEdit.kind')}
        value={profile.kind}
        choices={[
          { value: 'polygon', label: t('manualEdit.polygon') },
          { value: 'spline', label: t('manualEdit.spline') },
          { value: 'circle', label: t('manualEdit.circle') },
          { value: 'arc', label: t('manualEdit.arc') },
        ]}
        onChange={changeKind}
      />
      {pointProfile ? (
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            className='size-4'
            checked={isManualProfileClosed(profile)}
            onChange={(event) => {
              onChange({ ...pointProfile, closed: event.target.checked });
            }}
          />
          {t('manualEdit.closed')}
        </label>
      ) : null}
      {isManualProfileClosed(profile) ? null : (
        <p className='text-xs text-muted-foreground'>{t('manualEdit.openProfileHelp')}</p>
      )}
      {profile.kind === 'spline' ? <p className='text-xs text-muted-foreground'>{t('manualEdit.curveHelp')}</p> : null}
      {pointProfile ? (
        <details className='border-t border-border pt-3'>
          <summary className='text-sm font-medium'>{t('manualEdit.snapSettings')}</summary>
          <div className='space-y-3 pt-3'>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                className='size-4'
                checked={hasSnap}
                onChange={(event) => {
                  setHasSnap(event.target.checked);
                }}
              />
              {t('manualEdit.snap')}
            </label>
            <ManualNumberField
              label={t('manualEdit.grid')}
              value={grid}
              min={0.1}
              onChange={(nextGrid) => {
                if (nextGrid > 0) {
                  setGrid(nextGrid);
                }
              }}
            />
          </div>
        </details>
      ) : null}
      <details className='border-t border-border pt-3'>
        <summary className='text-sm font-medium'>{t('manualEdit.offset')}</summary>
        <div className='pt-3'>
          <fieldset className='space-y-2' aria-label={t('manualEdit.offset')}>
            <ManualNumberField label={t('manualEdit.offsetDistance')} value={offset} onChange={setOffset} />
            <p className='text-xs text-muted-foreground'>
              {t(
                profile.kind === 'spline'
                  ? 'manualEdit.offsetSplineHelp'
                  : isManualProfileClosed(profile)
                    ? 'manualEdit.offsetClosedHelp'
                    : 'manualEdit.offsetOpenHelp',
              )}
            </p>
            <Button
              size='sm'
              variant='outline'
              disabled={profile.kind === 'spline'}
              onClick={() => {
                try {
                  const changed = offsetManualProfile(profile, offset);
                  onChange(changed);
                  setOffsetError(undefined);
                  setBounds(manualProfileBounds(changed));
                } catch (error) {
                  setOffsetError(
                    t('manualEdit.offsetFailed', { detail: error instanceof Error ? error.message : String(error) }),
                  );
                }
              }}
            >
              {t('manualEdit.applyOffset')}
            </Button>
          </fieldset>
        </div>
      </details>
      {offsetError ? (
        <p role='alert' className='text-xs text-destructive'>
          {offsetError}
        </p>
      ) : null}
      <details className='border-t border-border pt-3'>
        <summary className='text-sm text-muted-foreground'>{t('manualEdit.profileExport')}</summary>
        <p className='pt-2 text-xs text-muted-foreground'>{t('manualEdit.sketchExportHelp')}</p>
      </details>
    </section>
  );
}
