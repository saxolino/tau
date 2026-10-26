import { randomUuid } from '@taucad/utils/id';
import { useId, useRef, useState } from 'react';
import { manualProfileSegments } from '@taucad/smlib/manual-operations';
import type { ManualProfile } from '@taucad/smlib/manual-operations';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';
import { ManualChoice, ManualNumberField } from '#routes/w.$workspace.$project/manual-edit-fields.js';

type Point = ManualProfile['points'][number];
const fitBounds = (points: readonly Point[]) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => -point.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 20) * 1.4;
  return { x: (Math.max(...xs) + Math.min(...xs) - span) / 2, y: (Math.max(...ys) + Math.min(...ys) - span) / 2, span };
};

/** The SVG and the native wire consume the same canonical cubic control points. */
function profilePath(profile: ManualProfile): string {
  const { points } = profile;
  const first = points[0];
  if (!first) {
    return '';
  }
  if (profile.kind === 'polygon') {
    return `M ${points.map((point) => `${point.x},${-point.y}`).join(' L ')} Z`;
  }
  const segments = manualProfileSegments(profile).map(
    ({ control1, control2, end }) => `C ${control1.x},${-control1.y} ${control2.x},${-control2.y} ${end.x},${-end.y}`,
  );
  return `M ${first.x},${-first.y} ${segments.join(' ')} Z`;
}

/** Pointer, touch and keyboard editing share the same canonical profile points. */
export function ManualProfileEditor({
  profile,
  onChange,
}: Readonly<{
  profile: ManualProfile;
  onChange: (profile: ManualProfile) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const patternId = useId();
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; pointerId: number; before: ManualProfile } | undefined>(undefined);
  const [selectedId, setSelectedId] = useState(profile.points[0]?.id);
  const [bounds, setBounds] = useState(() => fitBounds(profile.points));
  const [isAdding, setIsAdding] = useState(false);
  const [hasSnap, setHasSnap] = useState(true);
  const [grid, setGrid] = useState(1);
  const selected = profile.points.find((point) => point.id === selectedId) ?? profile.points[0];
  const snap = (value: number): number => (hasSnap ? Math.round(value / grid) * grid : Math.round(value * 1000) / 1000);
  const update = (id: string, changes: Partial<Pick<Point, 'x' | 'y'>>): void => {
    onChange({
      ...profile,
      points: profile.points.map((point) => (point.id === id ? { ...point, ...changes } : point)),
    });
  };
  const append = (x: number, y: number): void => {
    if (profile.points.length >= 256) {
      return;
    }
    const point = { id: randomUuid(), x, y };
    const points = [...profile.points];
    points.splice(
      selected ? points.findIndex((candidate) => candidate.id === selected.id) + 1 : points.length,
      0,
      point,
    );
    onChange({ ...profile, points });
    setSelectedId(point.id);
  };
  const remove = (): void => {
    if (!selected || profile.points.length <= 3) {
      return;
    }
    onChange({ ...profile, points: profile.points.filter((point) => point.id !== selected.id) });
    setSelectedId(profile.points.find((point) => point.id !== selected.id)?.id);
  };
  const coordinates = (event: React.PointerEvent<SVGElement>): { x: number; y: number } | undefined => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) {
      return undefined;
    }
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: snap(local.x), y: snap(-local.y) };
  };
  return (
    <section className='space-y-3' aria-label={t('manualEdit.profile')}>
      <ManualChoice
        label={t('manualEdit.kind')}
        value={profile.kind}
        choices={[
          { value: 'polygon', label: t('manualEdit.polygon') },
          { value: 'spline', label: t('manualEdit.spline') },
        ]}
        onChange={(kind) => {
          onChange({ ...profile, kind: kind === 'spline' ? 'spline' : 'polygon' });
        }}
      />
      <div className='flex flex-wrap gap-1'>
        <Button
          size='xs'
          variant={isAdding ? 'ghost' : 'secondary'}
          aria-pressed={!isAdding}
          onClick={() => {
            setIsAdding(false);
          }}
        >
          {t('manualEdit.movePoints')}
        </Button>
        <Button
          size='xs'
          variant={isAdding ? 'secondary' : 'ghost'}
          aria-pressed={isAdding}
          onClick={() => {
            setIsAdding(true);
          }}
        >
          {t('manualEdit.addPoints')}
        </Button>
        <Button
          size='xs'
          variant='ghost'
          onClick={() => {
            setBounds(fitBounds(profile.points));
          }}
        >
          {t('manualEdit.fit')}
        </Button>
      </div>
      <svg
        ref={svg}
        role='group'
        aria-label={t('manualEdit.drawing')}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.span} ${bounds.span}`}
        className='aspect-square w-full touch-none rounded-md border border-border bg-background'
        onPointerDown={(event) => {
          if (isAdding && event.button === 0) {
            const point = coordinates(event);
            if (point) {
              append(point.x, point.y);
            }
          }
        }}
        onPointerMove={(event) => {
          if (drag.current?.pointerId !== event.pointerId) {
            return;
          }
          const point = coordinates(event);
          if (point) {
            update(drag.current.id, point);
          }
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          if (drag.current) {
            onChange(drag.current.before);
          }
          drag.current = undefined;
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
        <path d={profilePath(profile)} className='fill-accent stroke-foreground' strokeWidth={bounds.span / 250} />
        {profile.points.map((point, index) => (
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
              if (event.button !== 0) {
                return;
              }
              setSelectedId(point.id);
              event.currentTarget.focus();
              drag.current = { id: point.id, pointerId: event.pointerId, before: profile };
              event.currentTarget.setPointerCapture(event.pointerId);
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
              if (event.key === 'Escape' && drag.current) {
                onChange(drag.current.before);
                drag.current = undefined;
              }
            }}
          />
        ))}
      </svg>
      <p className='text-xs text-muted-foreground'>{t('manualEdit.profileHelp')}</p>
      {profile.kind === 'spline' ? <p className='text-xs text-muted-foreground'>{t('manualEdit.curveHelp')}</p> : null}
      <label className='flex items-center gap-2 text-xs'>
        <input
          type='checkbox'
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
        onChange={(next) => {
          if (next > 0) {
            setGrid(next);
          }
        }}
      />
      {selected ? (
        <fieldset className='space-y-2'>
          <legend className='text-xs font-medium'>
            {t('manualEdit.selectedPoint')} · {profile.points.findIndex((point) => point.id === selected.id) + 1}
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
          <div className='flex flex-wrap gap-1'>
            <Button
              size='xs'
              variant='outline'
              disabled={profile.points.length >= 256}
              onClick={() => {
                const next =
                  profile.points[
                    (profile.points.findIndex((point) => point.id === selected.id) + 1) % profile.points.length
                  ]!;
                append((selected.x + next.x) / 2, (selected.y + next.y) / 2);
              }}
            >
              {t('manualEdit.addPoint')}
            </Button>
            <Button size='xs' variant='ghost' disabled={profile.points.length <= 3} onClick={remove}>
              {t('manualEdit.removePoint')}
            </Button>
          </div>
          <p className='text-xs text-muted-foreground'>{t('manualEdit.pointHelp')}</p>
        </fieldset>
      ) : null}
    </section>
  );
}
