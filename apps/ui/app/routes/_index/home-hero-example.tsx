import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { useProjects } from '#hooks/use-projects.js';
import { useProjectThumbnail } from '#hooks/use-project-thumbnail.js';
import { useTranslation } from '#i18n/translate.js';
import type { ProjectListItem } from '#types/project-library.types.js';
import { formatLastActivity } from '#routes/_index/home-recent-projects.js';
import { isPlaceholderProjectName } from '#utils/project-name.utils.js';
import { projectUrlOr } from '#utils/project-url.utils.js';

/** The sheet every example sits on: the CAD's own paper with its fine grid, in the theme's tokens. */
const sheetClass =
  'relative flex min-h-64 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px]';

/** The caption under the sheet: the eyelet, the name, one line of facts, and the one thing to do with it. */
const captionClass = 'border-t border-border bg-card/90 px-4 py-3';

/** One dimension line with its ticks and its value, in the drawing's millimetres. */
function Dimension({
  x1,
  y1,
  x2,
  y2,
  label,
  labelX,
  labelY,
}: Readonly<{ x1: number; y1: number; x2: number; y2: number; label: string; labelX: number; labelY: number }>) {
  const tick = 3;
  return (
    <g className='stroke-titanium-foreground' strokeWidth={1}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1 - tick} y1={y1 + tick} x2={x1 + tick} y2={y1 - tick} />
      <line x1={x2 - tick} y1={y2 + tick} x2={x2 + tick} y2={y2 - tick} />
      <text
        x={labelX}
        y={labelY}
        textAnchor='middle'
        className='fill-titanium-foreground stroke-none font-mono text-[10px] tracking-[0.08em] tabular-nums'
      >
        {label}
      </text>
    </g>
  );
}

/**
 * A drawing of the buckle the assistant proposes («Una fibbia 30 mm per cinturino»), the way the CAD's own delivery
 * draws a piece: front and side views in line, with the quotes in millimetres. Every stroke is a theme token.
 *
 * @returns The drawing.
 */
export function BuckleDrawing({ className }: Readonly<{ className?: string }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <svg
      role='img'
      aria-label={t('home.hero.drawingLabel')}
      viewBox='0 0 300 190'
      className={cn('h-auto w-full max-w-md', className)}
    >
      <g className='fill-none stroke-foreground' strokeWidth={1.25} strokeLinejoin='round'>
        {/* Front view: the frame, its opening, the bar and the prong (30 × 25 mm, scale 4 px per mm). */}
        <rect x={40} y={46} width={120} height={100} rx={20} />
        <rect x={56} y={62} width={88} height={68} rx={8} className='stroke-foreground/70' />
        <rect x={94} y={62} width={12} height={68} rx={6} className='fill-muted' />
        <rect x={98} y={90} width={66} height={12} rx={6} className='fill-card' />
        {/* Side view: the frame's thickness. */}
        <rect x={232} y={46} width={16} height={100} rx={3} />
        <rect x={244} y={90} width={10} height={8} rx={3} className='fill-card' />
      </g>
      {/* Extension lines. */}
      <g className='stroke-border' strokeWidth={1}>
        <line x1={40} y1={150} x2={40} y2={172} />
        <line x1={160} y1={150} x2={160} y2={172} />
        <line x1={36} y1={46} x2={18} y2={46} />
        <line x1={36} y1={146} x2={18} y2={146} />
        <line x1={232} y1={150} x2={232} y2={172} />
        <line x1={248} y1={150} x2={248} y2={172} />
      </g>
      <Dimension x1={40} y1={166} x2={160} y2={166} label='30' labelX={100} labelY={184} />
      <Dimension x1={22} y1={46} x2={22} y2={146} label='25' labelX={12} labelY={100} />
      <Dimension x1={232} y1={166} x2={248} y2={166} label='4' labelX={240} labelY={184} />
    </svg>
  );
}

/** The last project worked on, as the CAD saved its 3D thumbnail. */
function LastProjectExample({
  project,
  url,
  className,
}: Readonly<{ project: ProjectListItem; url: string; className?: string }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const name = isPlaceholderProjectName(project.name) ? t('home.recent.untitled') : project.name;
  return (
    <figure data-slot='home-hero-example' data-example='project' className={cn(sheetClass, className)}>
      <div className='flex min-h-0 flex-1 items-center justify-center p-4'>
        <img src={url} alt='' className='max-h-56 w-auto max-w-full object-contain' />
      </div>
      <figcaption className={captionClass}>
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0'>
            <Eyebrow>{t('home.hero.lastProject')}</Eyebrow>
            <p className='mt-0.5 truncate text-sm font-medium text-foreground'>{name}</p>
          </div>
          <Button asChild variant='ghost' size='sm' className='shrink-0'>
            <Link to={projectUrlOr(project.slugs)} aria-label={t('home.hero.openProject', { name })}>
              {t('shell.projects.open')}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
        <p className='mt-1 text-xs text-muted-foreground'>
          {t('home.recent.edited', { when: formatLastActivity(project.lastActivityAt, language) })}
        </p>
      </figcaption>
    </figure>
  );
}

/** The last project's thumbnail when the CAD saved one; the drawing stands in until it is read, and without one. */
function LastProjectOrDrawing({
  project,
  drawing,
  className,
}: Readonly<{ project: ProjectListItem; drawing: React.JSX.Element; className?: string }>): React.JSX.Element {
  const thumbnail = useProjectThumbnail(project.id);
  return thumbnail.url === undefined ? (
    drawing
  ) : (
    <LastProjectExample project={project} url={thumbnail.url} className={className} />
  );
}

/**
 * Beside the intake, what comes out: the last project's 3D thumbnail when there is one, otherwise the drawing of
 * the buckle the assistant proposes, which can be tried with one click. Only pictures the CAD made or draws itself.
 *
 * @param props - What to do when the example is tried.
 * @returns The example.
 */
export function HomeHeroExample({
  onTryExample,
  className,
}: Readonly<{ onTryExample: () => void; className?: string }>): React.JSX.Element {
  const { t } = useTranslation();
  const { projects } = useProjects();
  const last = useMemo(
    () =>
      projects
        .filter((project) => project.deletedAt === undefined)
        .sort((left, right) => right.lastActivityAt - left.lastActivityAt)[0],
    [projects],
  );
  const drawing = (
    <figure data-slot='home-hero-example' data-example='drawing' className={cn(sheetClass, className)}>
      <div className='flex min-h-0 flex-1 items-center justify-center px-6 py-4'>
        <BuckleDrawing />
      </div>
      <figcaption className={captionClass}>
        <div className='flex items-center justify-between gap-3'>
          <div className='min-w-0'>
            <Eyebrow>{t('home.hero.example')}</Eyebrow>
            <p className='mt-0.5 truncate text-sm font-medium text-foreground'>{t('home.hero.exampleTitle')}</p>
          </div>
          <Button type='button' variant='ghost' size='sm' className='shrink-0' onClick={onTryExample}>
            {t('home.hero.tryExample')}
            <ArrowRight aria-hidden />
          </Button>
        </div>
        <p className='mt-1 text-xs text-muted-foreground'>{t('home.hero.exampleCaption')}</p>
      </figcaption>
    </figure>
  );
  return last === undefined ? drawing : <LastProjectOrDrawing project={last} drawing={drawing} className={className} />;
}
