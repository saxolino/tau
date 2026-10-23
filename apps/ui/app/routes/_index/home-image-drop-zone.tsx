import { useId, useMemo, useRef } from 'react';
import { ImagePlus, ImageUp } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import { AttachmentImage, homeComposerAttachmentDirectory } from '#components/chat/attachment-preview.js';
import { useDraftSelector } from '#hooks/use-chat.js';
import { attachmentUrl } from '#utils/attachment.utils.js';
import { useTranslation } from '#i18n/translate.js';
import { homeImageAccept } from '#routes/_index/use-home-image-intake.js';

const pasteKeyCombination = { key: 'v', modKey: true } as const;

type HomeImageDropZoneProps = {
  /** Files are being dragged over the home. */
  readonly isDragging: boolean;
  /** Pictures chosen with the picker. */
  readonly onChooseFiles: (files: File[]) => void;
};

/**
 * The home's one big action, «Dall'immagine al CAD»: drop, paste or choose the photo or drawing of a piece. The
 * pictures go to the agent composer's draft (the home owns the drop and paste handling for the whole page); this
 * region shows where to drop, the limits, the picker, and the pictures already in the draft.
 *
 * @param props - Drag state and the picker's callback.
 * @returns The hero.
 */
export function HomeImageDropZone({ isDragging, onChooseFiles }: HomeImageDropZoneProps): React.JSX.Element {
  const { t } = useTranslation();
  const headingId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const attachments = useDraftSelector((state) => state.draftAttachments);
  /* One thumbnail per picture: the store names bytes by their hash, so a picture added twice is one picture. */
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

  return (
    <section aria-labelledby={headingId} className='mx-auto w-full max-w-3xl pt-8 md:pt-16'>
      <h1 id={headingId} className='text-4xl leading-[1.1] font-medium tracking-tight text-balance'>
        {t('home.title')}
      </h1>
      <p className='mt-3 max-w-prose text-base text-muted-foreground'>{t('home.subtitle')}</p>
      <div
        data-slot='home-drop-zone'
        data-dragging={isDragging}
        className={cn(
          'mt-6 flex flex-col items-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center',
          isDragging ? 'border-foreground/50 bg-muted' : 'border-border',
        )}
      >
        <ImageUp aria-hidden className='size-8 text-muted-foreground' />
        <div className='space-y-1'>
          <p className='text-base font-medium'>{isDragging ? t('home.dropZone.drop') : t('home.dropZone.dragHere')}</p>
          <p id={hintId} className='text-sm text-muted-foreground'>
            {t('home.dropZone.pasteHint', {
              shortcut: formatKeyCombination(pasteKeyCombination),
              limits: t('home.dropZone.limits'),
            })}
          </p>
        </div>
        <Button
          aria-describedby={hintId}
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          <ImagePlus aria-hidden />
          {t('home.dropZone.choose')}
        </Button>
        <input
          ref={inputRef}
          type='file'
          accept={homeImageAccept}
          multiple
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(event) => {
            // Copy first: clearing the input empties its live `FileList`.
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (files.length > 0) {
              onChooseFiles(files);
            }
          }}
        />
        {images.length > 0 ? (
          <ul aria-label={t('home.dropZone.imagesForAgent')} className='flex flex-wrap justify-center gap-2'>
            {images.map((image) => (
              <li key={image.hash} className='size-16 overflow-hidden rounded-md border'>
                <AttachmentImage
                  directory={homeComposerAttachmentDirectory}
                  part={{
                    url: attachmentUrl(image),
                    mediaType: image.mediaType,
                  }}
                  alt={image.filename ?? t('home.dropZone.attachedImage')}
                  className='size-full object-cover'
                />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className='mt-3 text-sm text-muted-foreground'>{t('home.dropZone.fromCreator')}</p>
    </section>
  );
}
