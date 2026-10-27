import { useId, useMemo, useRef } from 'react';
import { ImagePlus, ImageUp, MessageSquareText, Plus, X } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Input } from '@taucad/ui/components/input';
import { Label } from '@taucad/ui/components/label';
import { cn } from '@taucad/ui/utils/cn';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import { AttachmentImage, homeComposerAttachmentDirectory } from '#components/chat/attachment-preview.js';
import { SinopiaMark } from '#components/icons/sinopiacad-wordmark.js';
import { useChatComposer } from '#hooks/active-chat-provider.js';
import { useDraftActions, useDraftSelector } from '#hooks/use-chat.js';
import { attachmentUrl } from '#utils/attachment.utils.js';
import { useTranslation } from '#i18n/translate.js';
import { homeImageAccept } from '#routes/_index/use-home-image-intake.js';

const pasteKeyCombination = { key: 'v', modKey: true } as const;

type HomeImageDropZoneProps = {
  readonly isDragging: boolean;
  readonly onChooseSinopia: () => void;
  readonly onChooseFiles: (files: File[]) => void;
  /** The third way in: words to the assistant (the lane opens and its composer takes focus). */
  readonly onDescribe: () => void;
  readonly measure: string;
  readonly onMeasureChange: (measure: string) => void;
  readonly onBuild: () => void;
  readonly isSubmitting: boolean;
  readonly submitError?: string;
  readonly className?: string;
};

/**
 * The home's intake: the three ways in (a picture from the device, a Sinopia project, words to the assistant) and,
 * once pictures are in the draft, the ready state with the optional known measure and «Costruisci il CAD». Image
 * intake and ready state share the agent's draft; no project is created until the first send.
 *
 * @param props - The intake's state and callbacks.
 * @returns The intake.
 */
export function HomeImageDropZone({
  isDragging,
  onChooseFiles,
  onChooseSinopia,
  onDescribe,
  measure,
  onMeasureChange,
  onBuild,
  isSubmitting,
  submitError,
  className,
}: HomeImageDropZoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const { attachmentSource } = useChatComposer();
  const hintId = useId();
  const measureId = useId();
  const chooseButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
    <div
      data-slot='home-drop-zone'
      data-dragging={isDragging}
      aria-busy={isAttaching || isSubmitting}
      className={cn(
        'flex min-h-64 flex-col justify-center rounded-xl border bg-card p-5 shadow-xs transition-colors',
        isDragging ? 'border-dashed border-titanium bg-muted' : 'border-border',
        className,
      )}
    >
      {images.length > 0 ? (
        <div className='flex min-h-0 flex-1 flex-col gap-4'>
          <p className='text-sm font-medium'>{t('home.dropZone.ready')}</p>
          <ul aria-label={t('home.dropZone.imagesForAgent')} className='flex flex-wrap gap-3'>
            {images.map((image) => (
              <li key={image.hash} className='relative h-20 w-28 overflow-hidden rounded-lg border bg-muted'>
                <AttachmentImage
                  directory={attachmentSource ?? homeComposerAttachmentDirectory}
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
          <div className='mt-auto flex flex-wrap items-end gap-3'>
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
          <div className='flex items-start gap-4'>
            <div
              aria-hidden
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground',
                isDragging && 'border-titanium text-titanium-foreground',
              )}
            >
              <ImageUp className='size-5' />
            </div>
            <div id={hintId} className='min-w-0 space-y-1'>
              <p className='text-base leading-6 font-medium text-foreground'>
                {isDragging ? t('home.dropZone.drop') : t('home.dropZone.dragHere')}
              </p>
              <p className='text-sm text-muted-foreground'>
                {t('home.dropZone.pasteHint', {
                  shortcut: formatKeyCombination(pasteKeyCombination),
                  limits: t('home.dropZone.limits'),
                })}
              </p>
            </div>
          </div>
          {/* The three ways in; the picture is the filled one, the only filled control on the page. */}
          <div className='flex flex-wrap gap-2 pt-6'>
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
            <Button type='button' variant='outline' onClick={onChooseSinopia} disabled={isSubmitting}>
              <SinopiaMark aria-hidden className='size-4' />
              {t('sinopiaImages.fromProject')}
            </Button>
            <Button
              type='button'
              variant='outline'
              title={t('home.hero.describeHint')}
              onClick={onDescribe}
              disabled={isSubmitting}
            >
              <MessageSquareText aria-hidden />
              {t('home.hero.describe')}
            </Button>
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
  );
}
