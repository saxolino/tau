import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Check } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@taucad/ui/components/sheet';
import { Skeleton } from '@taucad/ui/components/skeleton';
import { randomUuid } from '@taucad/utils/id';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import {
  downloadSinopiaReferenceImage,
  listSinopiaReferenceImages,
  listSinopiaReferenceProjects,
} from '#services/sinopia-references.js';
import type {
  SinopiaImageLocation,
  SinopiaReferenceImage,
  SinopiaReferenceProject,
  SinopiaReferenceSelection,
} from '#services/sinopia-references.js';

type ImageProperties = Readonly<{
  userId: string;
  projectId: string;
  location: SinopiaImageLocation | undefined;
  alt: string;
  className?: string;
}>;

/** Sinopia's own default project name, stored in English: shown in the interface language instead. */
const isSinopiaPlaceholderName = (name: string): boolean => name.trim().toLowerCase() === 'untitled project';

/** Authenticated thumbnails load only when visible, with document-local object URLs disposed on identity changes. */
export const SinopiaReferenceThumbnail = memo(function SinopiaReferenceThumbnail({
  userId,
  projectId,
  className,
  location,
  alt,
}: ImageProperties): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!location || !ref.current) {
      return undefined;
    }
    let disposed = false;
    let objectUrl: string | undefined;
    let started = false;
    const load = async (): Promise<void> => {
      if (started) {
        return;
      }
      started = true;
      try {
        const blob = await downloadSinopiaReferenceImage({ userId, projectId, location });
        if (disposed) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        /* A decorative cover failure does not hide its accessible project/image action. */
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void load();
        observer.disconnect();
      }
    });
    observer.observe(ref.current);
    return () => {
      disposed = true;
      observer.disconnect();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [location, projectId, userId]);
  return (
    <div
      ref={ref}
      className={cn('flex aspect-4/3 w-full items-center justify-center overflow-hidden bg-muted', className)}
    >
      {url ? (
        <img src={url} alt={alt} className='size-full object-cover' />
      ) : (
        <ImageIcon aria-hidden className='size-6 text-muted-foreground' />
      )}
    </div>
  );
});

const filters = ['all', 'render', 'drawing', 'library'] as const;
type Filter = (typeof filters)[number];

type SheetProperties = Readonly<{
  project: SinopiaReferenceProject;
  onOpenChange: (isOpen: boolean) => void;
  onChoose: (selection: SinopiaReferenceSelection) => Promise<void>;
}>;

/** Multiple images share one intake gesture and one destination project, while filters retain the selection. */
function SinopiaImagesSheet({ project, onOpenChange, onChoose }: SheetProperties): React.JSX.Element {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isUsing, setIsUsing] = useState(false);
  const [hasImportError, setImportError] = useState(false);
  const session = useSinopiaSession();
  const currentUserId = session.status === 'signed-in' ? session.user.id : undefined;
  const currentUserRef = useRef(currentUserId);
  useEffect(() => {
    currentUserRef.current = currentUserId;
    return () => {
      currentUserRef.current = undefined;
    };
  }, [currentUserId]);
  const images = useQuery({
    queryKey: ['sinopia-reference-images', project.userId, project.id],
    queryFn: async ({ signal }) => listSinopiaReferenceImages(project.id, signal),
    enabled: currentUserId === project.userId,
    retry: false,
  });
  const visible = useMemo(
    () => (images.data ?? []).filter((image) => filter === 'all' || image.kind === filter),
    [filter, images.data],
  );
  const allSelected = visible.length > 0 && visible.every((image) => selected.has(image.id));
  const useImages = useCallback(async (): Promise<void> => {
    if (isUsing || !images.data || currentUserRef.current !== project.userId) {
      return;
    }
    setIsUsing(true);
    setImportError(false);
    try {
      const files: File[] = [];
      let totalBytes = 0;
      const measurements: Array<NonNullable<SinopiaReferenceSelection['measurements']>[number]> = [];
      for (const image of images.data.filter((item) => selected.has(item.id))) {
        // oxlint-disable-next-line no-await-in-loop -- download originals one at a time to limit peak memory
        const blob = await downloadSinopiaReferenceImage(image);
        totalBytes += blob.size;
        if (totalBytes > 64 * 1024 * 1024) {
          throw new Error('Too many reference images');
        }
        const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type.slice('image/'.length);
        const filename = `sinopia-${randomUuid()}.${extension}`;
        files.push(new File([blob], filename, { type: blob.type }));
        if (image.widthMm !== undefined || image.heightMm !== undefined) {
          measurements.push({ filename, name: image.name, widthMm: image.widthMm, heightMm: image.heightMm });
        }
      }
      if (currentUserRef.current !== project.userId) {
        return;
      }
      if (files.length > 0) {
        await onChoose({ userId: project.userId, projectId: project.id, files, measurements });
        onOpenChange(false);
      }
    } catch {
      setImportError(true);
    } finally {
      setIsUsing(false);
    }
  }, [images.data, isUsing, onChoose, onOpenChange, project.id, project.userId, selected]);
  const toggleImage = useCallback((id: string): void => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  return (
    <Sheet open={currentUserId === project.userId} onOpenChange={onOpenChange}>
      <SheetContent side='right' className='flex flex-col sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle>{t('sinopiaImages.imagesTitle', { name: project.name })}</SheetTitle>
          <SheetDescription>{t('sinopiaImages.description')}</SheetDescription>
        </SheetHeader>
        <div role='group' aria-label={t('sinopiaImages.filter')} className='flex flex-wrap gap-2 px-4'>
          {filters.map((value) => (
            <Button
              key={value}
              size='sm'
              variant={filter === value ? 'secondary' : 'ghost'}
              aria-pressed={filter === value}
              disabled={isUsing}
              onClick={() => {
                setFilter(value);
              }}
            >
              {t(`sinopiaImages.${value}`)}
            </Button>
          ))}
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto px-4'>
          {images.isPending ? (
            <p role='status' aria-busy='true' className='py-6 text-sm'>
              {t('sinopiaImages.loadingImages')}
            </p>
          ) : images.isError ? (
            <div role='alert' className='space-y-3 py-6'>
              <p className='text-sm'>{t('sinopiaImages.imagesError')}</p>
              <Button
                variant='outline'
                onClick={() => {
                  void images.refetch();
                }}
              >
                {t('sinopiaImages.retry')}
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <p className='py-6 text-sm text-muted-foreground'>{t('sinopiaImages.emptyImages')}</p>
          ) : (
            <>
              <Button
                variant='ghost'
                size='sm'
                className='my-2'
                disabled={isUsing}
                onClick={() => {
                  setSelected((previous) => {
                    const next = new Set(previous);
                    for (const image of visible) {
                      if (allSelected) {
                        next.delete(image.id);
                      } else {
                        next.add(image.id);
                      }
                    }
                    return next;
                  });
                }}
              >
                {t(allSelected ? 'sinopiaImages.clear' : 'sinopiaImages.selectAll')}
              </Button>
              <ul className='grid grid-cols-2 gap-3'>
                {visible.map((image) => (
                  <ReferenceImageCard
                    key={image.id}
                    image={image}
                    isSelected={selected.has(image.id)}
                    isDisabled={isUsing}
                    onToggle={toggleImage}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
        <div className='space-y-3 border-t p-4'>
          {hasImportError ? (
            <p role='alert' className='text-sm'>
              {t('sinopiaImages.importError')}
            </p>
          ) : null}
          <Button
            className='w-full'
            disabled={selected.size === 0 || isUsing || images.isError}
            aria-busy={isUsing}
            onClick={() => {
              void useImages();
            }}
          >
            {isUsing
              ? t('sinopiaImages.using')
              : t(selected.size === 1 ? 'sinopiaImages.useOne' : 'sinopiaImages.use', { count: selected.size })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const ReferenceImageCard = memo(function ReferenceImageCard({
  image,
  isSelected,
  isDisabled,
  onToggle,
}: Readonly<{
  image: SinopiaReferenceImage;
  isSelected: boolean;
  isDisabled: boolean;
  onToggle: (id: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const toggle = useCallback(() => {
    onToggle(image.id);
  }, [image.id, onToggle]);
  return (
    <li>
      <button
        type='button'
        aria-pressed={isSelected}
        aria-label={image.name ?? t('sinopiaImages.image')}
        disabled={isDisabled}
        onClick={toggle}
        className={cn(
          'relative w-full overflow-hidden rounded-lg border text-left hover:bg-muted focus-visible:focus-outline',
          isSelected ? 'border-foreground' : 'border-border',
        )}
      >
        <SinopiaReferenceThumbnail userId={image.userId} projectId={image.projectId} location={image.location} alt='' />
        {isSelected ? (
          <span className='absolute top-2 right-2 rounded-full bg-background p-1'>
            <Check aria-hidden className='size-4' />
          </span>
        ) : null}
        {image.name ? <span className='block truncate px-2 py-1 text-sm'>{image.name}</span> : null}
        {image.widthMm !== undefined && image.heightMm !== undefined ? (
          <span className='block px-2 pb-2 text-xs text-muted-foreground'>
            {t('sinopiaImages.dimensions', { width: image.widthMm, height: image.heightMm })}
          </span>
        ) : null}
      </button>
    </li>
  );
});

type StripProperties = Readonly<{
  onChoose: (selection: SinopiaReferenceSelection) => Promise<void>;
  isPickerOpen: boolean;
  onPickerOpenChange: (isOpen: boolean) => void;
}>;

/** Home's real dashboard strip and the hero's project picker share the same owned projects and image sheet. */
export function SinopiaProjectStrip(properties: StripProperties): React.JSX.Element | undefined {
  const session = useSinopiaSession();
  return session.status === 'signed-in' ? (
    <OwnedProjectStrip key={session.user.id} {...properties} userId={session.user.id} />
  ) : undefined;
}

function OwnedProjectStrip({
  onChoose,
  userId,
  isPickerOpen,
  onPickerOpenChange,
}: StripProperties & Readonly<{ userId: string }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const headingId = useId();
  const [project, setProject] = useState<SinopiaReferenceProject>();
  const projects = useQuery({
    queryKey: ['sinopia-reference-projects', userId],
    queryFn: async ({ signal }) => listSinopiaReferenceProjects(signal),
    retry: false,
  });
  const closeSheet = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      setProject(undefined);
    }
  }, []);
  const chooseProject = (chosen: SinopiaReferenceProject): void => {
    onPickerOpenChange(false);
    setProject(chosen);
  };
  // Only projects with images to start from: the project a CAD model lives in starts empty and is already a model.
  const startable = projects.data?.filter((item) => item.imageCount !== 0) ?? [];
  const collection = projects.isPending ? (
    <div role='status' aria-busy='true' aria-label={t('sinopiaImages.loading')} className='flex gap-3'>
      {['a', 'b', 'c', 'd', 'e'].map((key) => (
        <Skeleton key={key} className='aspect-4/3 w-44 shrink-0 rounded-lg' />
      ))}
    </div>
  ) : projects.isError ? (
    <div role='alert' className='space-y-3'>
      <p className='text-sm'>{t('sinopiaImages.error')}</p>
      <Button
        variant='outline'
        onClick={() => {
          void projects.refetch();
        }}
      >
        {t('sinopiaImages.retry')}
      </Button>
    </div>
  ) : startable.length === 0 ? (
    <div className='space-y-3 py-4'>
      <p className='text-sm text-muted-foreground'>{t('sinopiaImages.empty')}</p>
      <Button asChild variant='outline'>
        <a href='https://sinopialab.com/creator' target='_blank' rel='noopener noreferrer'>
          {t('sinopiaImages.creator')}
        </a>
      </Button>
    </div>
  ) : (
    <ul className='flex gap-3 overflow-x-auto pb-3'>
      {startable.map((item) => (
        <li key={item.id} className='w-44 shrink-0'>
          <button
            type='button'
            onClick={() => {
              chooseProject(item);
            }}
            className='w-full overflow-hidden rounded-lg border bg-card text-left hover:bg-muted focus-visible:focus-outline'
          >
            <SinopiaReferenceThumbnail
              userId={userId}
              projectId={item.thumbnail?.projectId ?? item.id}
              location={item.thumbnail}
              alt=''
            />
            <span className='block truncate px-3 pt-2 text-sm font-medium'>
              {isSinopiaPlaceholderName(item.name) ? t('sinopiaImages.untitled') : item.name}
            </span>
            {item.imageCount === undefined ? null : (
              <span className='block px-3 pt-1 text-xs text-muted-foreground'>
                {t(item.imageCount === 1 ? 'sinopiaImages.imageCountOne' : 'sinopiaImages.imageCount', {
                  count: item.imageCount,
                })}
              </span>
            )}
            {item.updatedAt ? (
              <span className='block px-3 pt-1 pb-3 text-xs text-muted-foreground'>
                {t('sinopiaImages.updated', {
                  date: new Intl.DateTimeFormat(language, { dateStyle: 'short' }).format(new Date(item.updatedAt)),
                })}
              </span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <section aria-labelledby={headingId} className='mt-10 space-y-4'>
      <div className='space-y-1'>
        <h2 id={headingId} className='text-lg font-semibold'>
          {t('sinopiaImages.title')}
        </h2>
        <p className='text-sm text-muted-foreground'>{t('sinopiaImages.subtitle')}</p>
      </div>
      {collection}
      <Sheet open={isPickerOpen} onOpenChange={onPickerOpenChange}>
        <SheetContent side='right' className='overflow-y-auto sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>{t('sinopiaImages.title')}</SheetTitle>
            <SheetDescription>{t('sinopiaImages.chooseProject')}</SheetDescription>
          </SheetHeader>
          <div className='px-4'>{collection}</div>
        </SheetContent>
      </Sheet>
      {project ? (
        <SinopiaImagesSheet key={project.id} project={project} onOpenChange={closeSheet} onChoose={onChoose} />
      ) : null}
    </section>
  );
}
