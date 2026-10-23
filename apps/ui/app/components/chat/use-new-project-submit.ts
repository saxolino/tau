import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { ChatTextareaProperties } from '#components/chat/chat-textarea-types.js';
import { toast } from '#components/ui/sonner.js';
import { useChatComposer } from '#hooks/active-chat-provider.js';
import type { ProjectCreationLocationState } from '#hooks/use-project-creation-location.js';
import { useProjectCreationLocation } from '#hooks/use-project-creation-location.js';
import { useProjectCreationLocationError } from '#hooks/use-project-creation-location-error.js';
import { useProjectManager } from '#hooks/use-project-manager.js';
import { useTranslation } from '#i18n/translate.js';
import { projectUrl } from '#utils/project-url.utils.js';
import { sinopiaStarterKernelId } from '#lib/sinopia-engines.js';
import { homeProjectCreationLocation } from '#types/project-creation-location.types.js';

/** The home hero and composer create through the same attachment-preserving first-turn flow. */
export function useNewProjectSubmit(enableLocationPicker: boolean): {
  readonly onSubmit: ChatTextareaProperties['onSubmit'];
  readonly isSubmitting: boolean;
  readonly location: ProjectCreationLocationState;
  readonly canCreate: boolean;
} {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pending = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const projectManager = useProjectManager();
  const location = useProjectCreationLocation();
  const presentLocationError = useProjectCreationLocationError();
  const {
    draftActorRef,
    attachmentSource,
    execution: { execution },
    consumeDraft,
  } = useChatComposer();

  /* Without the picker the project goes to Home; the location hook still runs, so the hooks keep their order. */
  const creationLocation = enableLocationPicker
    ? location.phase === 'ready'
      ? location.value
      : undefined
    : homeProjectCreationLocation;
  const canCreate = enableLocationPicker ? location.canCreate : true;

  const onSubmit: ChatTextareaProperties['onSubmit'] = useCallback(
    async ({ content }) => {
      if (pending.current || creationLocation === undefined) {
        return;
      }
      pending.current = true;
      setIsSubmitting(true);
      // The stored draft is the source of truth for attachments: the new
      // project's chat receives copies of exactly these bytes.
      const attachments = draftActorRef
        .getSnapshot()
        .context.draftAttachments.map(({ byteLength: _byteLength, ...stored }) => stored);
      try {
        const created = await projectManager.createProject({
          /* The empty starter file only: the chat pins no engine, and the agent chooses one for the job. */
          kernel: sinopiaStarterKernelId,
          /* The chip's value verbatim — not a Tau execution rebuilt from the
           * model. Rebuilding dropped `hostId` (and any `acp` choice),
           * so a project started from a "Tau Host · …" chip ran its first turn
           * in this browser instead, against a chip that still named the
           * daemon. Both providers keep this execution's Tau model in step with
           * the model chip, so there is nothing left to override here. */
          activeExecution: execution,
          initialMessage: {
            content,
            attachments,
            ...(attachmentSource === undefined ? {} : { attachmentSource }),
          },
          editorState: {
            panelState: {
              desktopLayout: { chatOpen: true, compactAuxiliary: 'chat' },
              mobileActiveTab: 'chat',
            },
          },
          location: creationLocation,
        });
        await consumeDraft();
        await navigate(projectUrl(created.slugs));
      } catch (error) {
        if (presentLocationError(error)) {
          if (location.phase === 'ready' && location.hasWebAccessCapability) {
            await location.refresh();
          }
          return;
        }
        console.error('Failed to create project:', error);
        toast.error(t('home.composer.createFailed'));
      } finally {
        pending.current = false;
        setIsSubmitting(false);
      }
    },
    [
      attachmentSource,
      consumeDraft,
      creationLocation,
      draftActorRef,
      execution,
      location,
      navigate,
      presentLocationError,
      projectManager,
      t,
    ],
  );

  return { onSubmit, isSubmitting, location, canCreate };
}
