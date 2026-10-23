import { useId, useMemo, useRef, useState } from 'react';
import { ImagePlus, ImageUp, Plus, X } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Input } from '@taucad/ui/components/input';
import { Label } from '@taucad/ui/components/label';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@taucad/ui/components/sheet';
import { cn } from '@taucad/ui/utils/cn';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import { AttachmentImage, homeComposerAttachmentDirectory } from '#components/chat/attachment-preview.js';
import { useDraftActions, useDraftSelector } from '#hooks/use-chat.js';
import { attachmentUrl } from '#utils/attachment.utils.js';
import { useTranslation } from '#i18n/translate.js';
import { homeImageAccept } from '#routes/_index/use-home-image-intake.js';

const pasteKeyCombination = { key: 'v', modKey: true } as const;

type HomeImageDropZoneProps = {
  readonly isDragging: boolean;
  readonly onChooseFiles: (files: File[]) => void;
  readonly measure: string;
  readonly onMeasureChange: (measure: string) => void;
  readonly onBuild: () => void;
  readonly isSubmitting: boolean;
  readonly submitError?: string;
};

/** Image intake and ready state share the agent's draft; no project is created until the first send. */
export function HomeImageDropZone({
  isDragging,
  onChooseFiles,
  measure,
  onMeasureChange,
  onBuild,
  isSubmitting,
  submitError,
}: HomeImageDropZoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const hintId = useId();
  const measureId = useId();
  const chooseButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isSinopiaOpen, setIsSinopiaOpen] = useState(false);
  const attachments = useDraftSelector((state) => state.draftAttachments);
  const isAttaching = useDraftSelector((state) => state.attachingMain);
  const { removeDraftAttachment } = useDraftActions();
  const images = useMemo(() => {
    const seen = new Set<string>();
    return attachments.filter((attachment) => {
      if (!attachment.mediaType.startsWith('image/') || seen.has(attachment.hash)) {
        return false;
      }
      seen.add(attachment.hash);
      return true;
    });
  }, [attachments]);
  const choose = (): void => inputRef.current?.click();
  const removeImage = (hash: string): void => {
    // Remove all occurrences, using original draft indices (documents can precede images).
    for (let index = attachments.length - 1; index >= 0; index -= 1) {
      if (attachments[index]?.hash === hash) {
        removeDraftAttachment(index);
      }
    }
    if (images.length === 1) {
      onMeasureChange('');
    }
  };

  return (
    <section aria-labelledby={headingId} className='w-full pt-6'>
      <h1 id={headingId} className='text-3xl leading-tight font-semibold tracking-tight text-balance'>
        {t('home.title')}
      </h1>
      <p className='mt-2 max-w-prose text-sm text-muted-foreground'>{t('home.subtitle')}</p>
      <div
        data-slot='home-drop-zone'
        data-dragging={isDragging}
        aria-busy={isAttaching || isSubmitting}
        className={cn(
          'mt-5 flex min-h-58 flex-col items-center justify-center gap-4 rounded-xl border bg-card p-7 text-center shadow-xs',
          isDragging ? 'border-foreground/50 bg-muted' : 'border-border',
        )}
      >
        {images.length > 0 ? (
          <div className='w-full max-w-3xl space-y-4 text-left'>
            <p className='text-sm font-medium'>{t('home.dropZone.ready')}</p>
            <ul aria-label={t('home.dropZone.imagesForAgent')} className='flex flex-wrap gap-3'>
              {images.map((image) => (
                <li key={image.hash} className='relative h-20 w-28 overflow-hidden rounded-lg border bg-muted'>
                  <AttachmentImage
                    directory={homeComposerAttachmentDirectory}
                    part={{ url: attachmentUrl(image), mediaType: image.mediaType }}
                    alt={t('home.dropZone.attachedImage')}
                    className='size-full object-cover'
                  />
                  <Button
                    type='button'
                    variant='overlay'
                    size='icon-xs'
                    className='absolute top-1 right-1'
                    aria-label={t('home.dropZone.remove', { name: t('home.dropZone.attachedImage') })}
                    disabled={isSubmitting || isAttaching}
                    onClick={() => {
                      removeImage(image.hash);
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                </li>
              ))}
              <li className='flex items-center'>
                <Button type='button' variant='outline' disabled={isSubmitting} onClick={choose}>
                  <Plus aria-hidden />
                  {t('home.dropZone.addView')}
                </Button>
              </li>
            </ul>
            {submitError === undefined ? null : (
              <p role='alert' className='text-sm'>
                {submitError}
              </p>
            )}
            <div className='flex flex-wrap items-end gap-3'>
              <div className='min-w-0 flex-1 space-y-2'>
                <Label htmlFor={measureId}>{t('home.dropZone.measure')}</Label>
                <Input
                  id={measureId}
                  value={measure}
                  placeholder={t('home.dropZone.measureHint')}
                  disabled={isSubmitting}
                  onChange={(event) => {
                    onMeasureChange(event.target.value);
                  }}
                />
              </div>
              <Button
                type='button'
                disabled={isSubmitting || isAttaching || submitError !== undefined}
                aria-busy={isSubmitting}
                onClick={onBuild}
              >
                {t(isSubmitting ? 'home.dropZone.building' : 'home.dropZone.build')}
              </Button>
              <Button
                type='button'
                variant='ghost'
                disabled={isSubmitting || isAttaching}
                onClick={() => {
                  for (let index = attachments.length - 1; index >= 0; index -= 1) {
                    if (attachments[index]?.mediaType.startsWith('image/')) {
                      removeDraftAttachment(index);
                    }
                  }
                  onMeasureChange('');
                  requestAnimationFrame(() => {
                    chooseButtonRef.current?.focus();
                  });
                }}
              >
                {t('home.dropZone.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className='flex size-10 items-center justify-center rounded-lg border bg-muted'>
              <ImageUp aria-hidden className='size-5 text-muted-foreground' />
            </div>
            <div className='flex flex-wrap justify-center gap-3'>
              <Button
                ref={chooseButtonRef}
                type='button'
                aria-describedby={hintId}
                disabled={isSubmitting}
                onClick={choose}
              >
                <ImagePlus aria-hidden />
                {t('home.dropZone.choose')}
              </Button>
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  setIsSinopiaOpen(true);
                }}
              >
                {t('home.dropZone.fromSinopia')}
              </Button>
            </div>
            <div id={hintId} className='space-y-1 text-sm text-muted-foreground'>
              <p>{isDragging ? t('home.dropZone.drop') : t('home.dropZone.dragHere')}</p>
              <p>
                {t('home.dropZone.pasteHint', {
                  shortcut: formatKeyCombination(pasteKeyCombination),
                  limits: t('home.dropZone.limits'),
                })}
              </p>
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type='file'
          accept={homeImageAccept}
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length > 0) {
              onChooseFiles(files);
            }
          }}
        />
      </div>
      {/* Step 6 connects this sheet to real Sinopia images, through onChooseFiles and the same draft. */}
      <Sheet open={isSinopiaOpen} onOpenChange={setIsSinopiaOpen}>
        <SheetContent side='right' className='sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>{t('home.dropZone.sinopiaTitle')}</SheetTitle>
            <SheetDescription>{t('home.dropZone.sinopiaDescription')}</SheetDescription>
          </SheetHeader>
          <SheetClose asChild>
            <Button variant='outline' className='mx-4'>
              {t('home.dropZone.close')}
            </Button>
          </SheetClose>
        </SheetContent>
      </Sheet>
    </section>
  );
}
