import { useCallback, useMemo } from 'react';
import { modelSupportsInput } from '@taucad/chat';
import { useChatComposer } from '#hooks/active-chat-provider.js';
import { useDraftActions } from '#hooks/use-chat.js';
import { attachmentModelForExecution } from '#utils/chat.utils.js';
import { readFileAsDataUrl } from '#components/chat/chat-paste-handler.js';
import { toast } from '#components/ui/sonner.js';
import type { Language } from '#i18n/language.js';
import { useTranslation } from '#i18n/translate.js';

/** The pictures the home takes: what the attachment store keeps as images. */
export const homeImageMediaTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/** The picker's `accept` list. */
export const homeImageAccept = homeImageMediaTypes.join(',');

/**
 * The largest picture the home reads. The draft then shrinks it under the 4 MiB the agent receives, so this only
 * keeps a huge scan or RAW export from being read whole into memory.
 */
export const homeImageMaxBytes = 20 * 1024 * 1024;

const isHomeImage = (file: File): boolean => (homeImageMediaTypes as readonly string[]).includes(file.type);

/** The picture's name in a sentence, in the language's quotes; a pasted picture has none and `fallback` stands in. */
const fileLabel = (file: File, fallback: string, language: Language): string => {
  if (file.name === '') {
    return fallback;
  }
  return language === 'it' ? `«${file.name}»` : `"${file.name}"`;
};

/**
 * Puts pictures dropped, pasted or chosen on the home into the agent composer's draft: the same draft the composer
 * sends, through its own `addDraftAttachment`, so the draft machine resizes and stores them as it does for the
 * composer's own drops. Only images within {@link homeImageMaxBytes} are taken, and only when the agent's model reads
 * images; every refusal says why, in the language of the interface.
 *
 * Call inside the home's composer provider.
 *
 * @returns `addImages`, which resolves to how many pictures went into the draft.
 */
export function useHomeImageIntake(): {
  readonly addImages: (files: Iterable<File>) => Promise<number>;
} {
  const {
    model: { model: selectedModel },
    execution: { execution },
  } = useChatComposer();
  const { addDraftAttachment } = useDraftActions();
  const { t, language } = useTranslation();
  const attachmentModel = useMemo(
    () => attachmentModelForExecution(execution, selectedModel),
    [execution, selectedModel],
  );
  const canReadImages = modelSupportsInput(attachmentModel.support, 'image');

  const addImages = useCallback(
    async (files: Iterable<File>): Promise<number> => {
      const list = [...files];
      if (list.length === 0) {
        return 0;
      }
      if (!canReadImages) {
        toast.error(t('home.intake.cannotReadImages'), {
          description: t('home.intake.cannotReadImagesHint'),
        });
        return 0;
      }
      let added = 0;
      for (const file of list) {
        if (!isHomeImage(file)) {
          toast.error(
            t('home.intake.wrongFormat', {
              name: fileLabel(file, t('home.intake.thePictureCapital'), language),
            }),
            {
              description: t('home.intake.wrongFormatHint', {
                limits: t('home.dropZone.limits'),
              }),
            },
          );
          continue;
        }
        if (file.size > homeImageMaxBytes) {
          toast.error(
            t('home.intake.tooBig', {
              name: fileLabel(file, t('home.intake.thePictureCapital'), language),
            }),
            {
              description: t('home.intake.tooBigHint'),
            },
          );
          continue;
        }
        try {
          // oxlint-disable-next-line no-await-in-loop -- reading in order keeps the pictures in the order they came
          const dataUrl = await readFileAsDataUrl(file);
          addDraftAttachment(dataUrl, {
            model: attachmentModel,
            ...(file.name === '' ? {} : { filename: file.name }),
          });
          added += 1;
        } catch {
          toast.error(
            t('home.intake.readFailed', {
              name: fileLabel(file, t('home.intake.thePicture'), language),
            }),
          );
        }
      }
      return added;
    },
    [addDraftAttachment, attachmentModel, canReadImages, language, t],
  );

  return { addImages };
}
