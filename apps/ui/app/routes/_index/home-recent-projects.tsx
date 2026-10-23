import { useId, useMemo } from 'react';
import { Box, FolderOpen } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@taucad/ui/components/button';
import { Card, CardHeader } from '@taucad/ui/components/card';
import { PanelEmptyState } from '@taucad/ui/components/panel-empty-state';
import { Skeleton } from '@taucad/ui/components/skeleton';
import { languageLocales } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import { translate, useTranslation } from '#i18n/translate.js';
import { ProjectCard } from '#components/project-card.js';
import { projectGridClassName } from '#components/project-grid-layout.js';
import { useProjects } from '#hooks/use-projects.js';
import { useProjectThumbnail } from '#hooks/use-project-thumbnail.js';
import type { ProjectListItem } from '#types/project-library.types.js';
import { projectUrlOr } from '#utils/project-url.utils.js';

/** Two rows at the widest grid. */
export const homeRecentProjectLimit = 10;

const relativeTimes: Readonly<Record<Language, Intl.RelativeTimeFormat>> = {
  it: new Intl.RelativeTimeFormat(languageLocales.it, { numeric: 'auto' }),
  en: new Intl.RelativeTimeFormat(languageLocales.en, { numeric: 'auto' }),
};
const absoluteDates: Readonly<Record<Language, Intl.DateTimeFormat>> = {
  it: new Intl.DateTimeFormat(languageLocales.it, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
  en: new Intl.DateTimeFormat(languageLocales.en, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
};

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/**
 * When a project was last worked on, in the language given: IT «adesso», «5 minuti fa», «ieri», EN "now", "5 minutes
 * ago", "yesterday"; then the date after a week.
 *
 * @param timestamp - The project's last activity.
 * @param language - The language to write it in.
 * @param now - The current time.
 * @returns The phrase.
 */
export const formatLastActivity = (timestamp: number, language: Language, now: number = Date.now()): string => {
  const relativeTime = relativeTimes[language];
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < minute) {
    return translate(language, 'home.recent.now');
  }
  if (elapsed < hour) {
    return relativeTime.format(-Math.floor(elapsed / minute), 'minute');
  }
  if (elapsed < day) {
    return relativeTime.format(-Math.floor(elapsed / hour), 'hour');
  }
  if (elapsed < 7 * day) {
    return relativeTime.format(-Math.floor(elapsed / day), 'day');
  }
  return absoluteDates[language].format(timestamp);
};

function HomeProjectCard({ project }: { readonly project: ProjectListItem }): React.JSX.Element {
  const { t, language } = useTranslation();
  const thumbnail = useProjectThumbnail(project.id);
  return (
    <ProjectCard
      to={projectUrlOr(project.slugs)}
      linkLabel={t('home.recent.open', { name: project.name })}
      className='flex flex-col'
    >
      {/* The card link names the card, so the picture is decorative. */}
      <div className='relative aspect-4/3 w-full overflow-hidden bg-muted'>
        {thumbnail.url === undefined ? (
          <div className='flex size-full items-center justify-center text-muted-foreground'>
            <Box aria-hidden className='size-8' />
          </div>
        ) : (
          <img src={thumbnail.url} alt='' className='size-full object-cover' loading='lazy' />
        )}
      </div>
      <CardHeader className='gap-1'>
        <h3 className='line-clamp-1 text-base font-semibold'>{project.name}</h3>
        <p className='text-sm text-muted-foreground'>
          {t('home.recent.edited', {
            when: formatLastActivity(project.lastActivityAt, language),
          })}
        </p>
      </CardHeader>
    </ProjectCard>
  );
}

/**
 * «I tuoi progetti» on the home: the most recently worked-on projects as model thumbnails, on the library's grid and
 * card anatomy, with the way to the whole library. Renaming, trash and folders stay in the library.
 *
 * @returns The section.
 */
export function HomeRecentProjects(): React.JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const { projects, isLoading, error, retry } = useProjects();
  const recent = useMemo(
    () =>
      // The listing leaves trashed projects out.
      [...projects].sort((left, right) => right.lastActivityAt - left.lastActivityAt).slice(0, homeRecentProjectLimit),
    [projects],
  );

  return (
    <section aria-labelledby={headingId} className='mx-auto w-full max-w-7xl pt-12 pb-10'>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-4'>
        <h2 id={headingId} className='text-2xl font-semibold tracking-tight'>
          {t('home.recent.title')}
        </h2>
        {recent.length > 0 ? (
          <Button asChild variant='link'>
            <Link to='/projects'>{t('home.recent.all')}</Link>
          </Button>
        ) : null}
      </div>
      {error !== undefined && projects.length === 0 ? (
        <div role='alert' className='flex flex-wrap items-center justify-between gap-3 rounded-md border p-4'>
          <span className='text-sm'>{t('home.recent.loadFailed')}</span>
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              void retry();
            }}
          >
            {t('home.recent.retry')}
          </Button>
        </div>
      ) : isLoading && projects.length === 0 ? (
        <div role='status' aria-busy='true' aria-label={t('home.recent.loading')} className={projectGridClassName}>
          {Array.from({ length: 4 }, (_, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a fixed set of placeholders
            <Card key={index} className='overflow-hidden pt-0'>
              <Skeleton className='aspect-4/3 w-full rounded-none' />
              <CardHeader>
                <Skeleton className='h-6 w-3/4' />
                <Skeleton className='h-4 w-1/2' />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : recent.length === 0 ? (
        <PanelEmptyState
          icon={FolderOpen}
          title={t('home.recent.emptyTitle')}
          description={t('home.recent.emptyDescription')}
          className='h-48'
        />
      ) : (
        <ul role='list' className={projectGridClassName}>
          {recent.map((project) => (
            <li key={project.id}>
              <HomeProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
