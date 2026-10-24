import { z } from 'zod';
import { memo, useCallback, useId, useMemo, useState } from 'react';
import { Box, FolderOpen, ChevronDown } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@taucad/ui/components/button';
import { Card, CardHeader } from '@taucad/ui/components/card';
import { PanelEmptyState } from '@taucad/ui/components/panel-empty-state';
import { Skeleton } from '@taucad/ui/components/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@taucad/ui/components/dropdown-menu';
import { searchParameterName } from '#constants/search-parameter.constants.js';
import { useSearchParameter } from '#hooks/use-search-parameter.js';
import { enumParameter } from '#utils/search-parameter.codecs.js';
import { languageLocales } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import { translate, useTranslation } from '#i18n/translate.js';
import { ProjectCard } from '#components/project-card.js';
import { useProjects } from '#hooks/use-projects.js';
import { useProjectThumbnail } from '#hooks/use-project-thumbnail.js';
import type { ProjectListItem } from '#types/project-library.types.js';
import { useCloudProjects } from '#hooks/use-cloud-projects.js';
import type { CloudProject } from '#hooks/use-cloud-projects.js';
import { useOpenCloudProject } from '#hooks/use-open-cloud-project.js';
import { isCloudOnly, toLibraryRows } from '#routes/projects_/cloud-projects.js';
import { SinopiaReferenceThumbnail } from '#routes/_index/sinopia-project-strip.js';
import { toast } from '#components/ui/sonner.js';
import { projectUrlOr } from '#utils/project-url.utils.js';

/** A bounded home preview; the full collection stays in Projects. */
export const homeRecentProjectLimit = 10;

const homeProjectGridClassName = 'grid grid-cols-2 gap-4 min-[1367px]:grid-cols-4';
const sortParameter = enumParameter(z.enum(['modified', 'name']), 'modified');

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

const HomeProjectCard = memo(function HomeProjectCard({
  project,
  pieceCount,
}: {
  readonly project: ProjectListItem;
  readonly pieceCount?: number;
}): React.JSX.Element {
  const { t, language } = useTranslation();
  const thumbnail = useProjectThumbnail(project.id);
  return (
    <ProjectCard
      to={projectUrlOr(project.slugs)}
      linkLabel={t('home.recent.open', { name: project.name })}
      className='flex flex-col'
    >
      {/* The card link names the card, so the picture is decorative. */}
      <div className='relative aspect-8/5 w-full overflow-hidden bg-muted'>
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
          {pieceCount === undefined ? null : (
            <> · {t(pieceCount === 1 ? 'home.recent.piece' : 'home.recent.pieces', { count: pieceCount })}</>
          )}
        </p>
      </CardHeader>
    </ProjectCard>
  );
});

const HomeRemoteProjectCard = memo(function HomeRemoteProjectCard({
  project,
  onOpen,
}: Readonly<{
  project: CloudProject;
  onOpen: (project: CloudProject) => Promise<void>;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  const [isOpening, setIsOpening] = useState(false);
  const location = useMemo(
    () =>
      project.sinopia?.thumbnail_path ? { bucket: 'creator-private', path: project.sinopia.thumbnail_path } : undefined,
    [project.sinopia],
  );
  const open = useCallback(async (): Promise<void> => {
    setIsOpening(true);
    try {
      await onOpen(project);
    } catch {
      toast.error(t('sinopiaImages.openError'));
    } finally {
      setIsOpening(false);
    }
  }, [onOpen, project, t]);
  return (
    <ProjectCard
      onOpen={open}
      isOpening={isOpening}
      linkLabel={t(isOpening ? 'sinopiaImages.opening' : 'home.recent.open', { name: project.name })}
    >
      {project.sinopia ? (
        <SinopiaReferenceThumbnail
          userId={project.sinopia.user_id}
          projectId={project.sinopia.project_id}
          className='aspect-8/5'
          location={location}
          alt=''
        />
      ) : (
        <div className='flex aspect-8/5 items-center justify-center bg-muted'>
          <Box aria-hidden className='size-8 text-muted-foreground' />
        </div>
      )}
      <CardHeader className='gap-1'>
        <h3 className='line-clamp-1 text-base font-semibold'>{project.name}</h3>
        {project.updatedAt === undefined ? null : (
          <p className='text-sm text-muted-foreground'>
            {t('home.recent.edited', { when: formatLastActivity(project.updatedAt, language) })}
          </p>
        )}
      </CardHeader>
    </ProjectCard>
  );
});

/**
 * «I tuoi progetti» on the home: the most recently worked-on projects as model thumbnails, on the library's grid and
 * card anatomy, with the way to the whole library. Renaming, trash and folders stay in the library.
 *
 * @returns The section.
 */
export function HomeRecentProjects({
  pieceCounts,
}: {
  /** Counts from named-piece metadata, when available; file counts are never piece counts. */
  readonly pieceCounts?: ReadonlyMap<string, number>;
}): React.JSX.Element {
  const { t, language } = useTranslation();
  const headingId = useId();
  const [sort, setSort] = useSearchParameter(searchParameterName.sort, sortParameter);
  const { projects: held, isLoading, error, retry } = useProjects({ includeDeleted: true });
  const cloud = useCloudProjects();
  const openCloudProject = useOpenCloudProject();
  const projects = useMemo(
    () =>
      toLibraryRows({
        projects: held.filter((item) => item.deletedAt === undefined),
        held,
        cloud: cloud.projects,
        includeCloudOnly: true,
      }),
    [cloud.projects, held],
  );
  const recent = useMemo(
    () =>
      // The listing leaves trashed projects out.
      [...projects]
        .sort((left, right) =>
          sort === 'name'
            ? left.name.localeCompare(right.name, languageLocales[language])
            : right.lastActivityAt - left.lastActivityAt,
        )
        .slice(0, homeRecentProjectLimit),
    [projects, sort, language],
  );

  return (
    <section aria-labelledby={headingId} className='@container/home w-full pt-9 pb-10'>
      <div className='mb-4 flex flex-wrap items-center justify-between gap-4'>
        <h2 id={headingId} className='text-lg font-semibold'>
          {t('home.recent.title')}
        </h2>
        {recent.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant='outline' size='sm' aria-label={t('home.recent.sort')}>
                {t(sort === 'name' ? 'home.recent.sortName' : 'home.recent.sortRecent')}
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(value) => {
                  setSort(sortParameter.parse(value));
                }}
              >
                <DropdownMenuRadioItem value='modified'>{t('home.recent.sortRecent')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value='name'>{t('home.recent.sortName')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {recent.length > 0 ? (
          <Button asChild variant='link'>
            <Link to='/projects'>{t('home.recent.all')}</Link>
          </Button>
        ) : null}
      </div>
      {cloud.isFailed ? (
        <div role='alert' className='mb-4 flex items-center justify-between gap-3 rounded-md border p-4'>
          <p className='text-sm'>{t('sinopiaImages.cadError')}</p>
          <Button variant='outline' size='sm' onClick={cloud.retry}>
            {t('sinopiaImages.retry')}
          </Button>
        </div>
      ) : null}
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
      ) : (isLoading || (cloud.isFetching && !cloud.isSettled)) && projects.length === 0 ? (
        <div role='status' aria-busy='true' aria-label={t('home.recent.loading')} className={homeProjectGridClassName}>
          {Array.from({ length: 4 }, (_, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- a fixed set of placeholders
            <Card key={index} className='overflow-hidden pt-0'>
              <Skeleton className='aspect-8/5 w-full rounded-none' />
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
        <ul role='list' className={homeProjectGridClassName}>
          {recent.map((project) => (
            <li key={project.id}>
              {isCloudOnly(project) ? (
                <HomeRemoteProjectCard project={project} onOpen={openCloudProject} />
              ) : (
                <HomeProjectCard project={project} pieceCount={pieceCounts?.get(project.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
