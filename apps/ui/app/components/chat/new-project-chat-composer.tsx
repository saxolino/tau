import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChatTextarea } from '#components/chat/chat-textarea.js';
import type { ChatTextareaHandle, ChatTextareaProperties } from '#components/chat/chat-textarea-types.js';
import { WorkspaceSelector } from '#components/filesystem/workspace-selector.js';
import { toast } from '#components/ui/sonner.js';
import { useChatComposer } from '#hooks/active-chat-provider.js';
import { useProjectCreationLocation } from '#hooks/use-project-creation-location.js';
import { useProjectCreationLocationError } from '#hooks/use-project-creation-location-error.js';
import { useProjectManager } from '#hooks/use-project-manager.js';
import { useTranslation } from '#i18n/translate.js';
import { projectUrl } from '#utils/project-url.utils.js';
import { sinopiaStarterKernelId } from '#lib/sinopia-engines.js';
import { homeProjectCreationLocation } from '#types/project-creation-location.types.js';

type NewProjectChatComposerProperties = {
  /** Focuses the composer from outside, as the home does after an image lands in the draft. */
  readonly ref?: React.Ref<ChatTextareaHandle>;
  readonly enableAutoFocus?: boolean;
  /**
   * Offer the creation-location control (Home or a connected folder). Without it the project is created in Home, as
   * SinopiaCAD's home does.
   */
  readonly enableLocationPicker?: boolean;
  readonly className?: string;
};

/** Shared direct-create composer rendered inside an existing chat provider. */
export function NewProjectChatComposer({
  ref,
  enableAutoFocus = true,
  enableLocationPicker = true,
  className,
}: NewProjectChatComposerProperties): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectManager = useProjectManager();
  const location = useProjectCreationLocation();
  const presentLocationError = useProjectCreationLocationError();
  const textareaRef = useRef<ChatTextareaHandle>(null);
  const {
    draftActorRef,
    attachmentSource,
    execution: { execution },
    consumeDraft,
  } = useChatComposer();

  const focusComposer = useCallback((): void => {
    textareaRef.current?.focus();
  }, []);
  useImperativeHandle(ref, () => ({ focus: focusComposer }), [focusComposer]);
  /* Without the picker the project goes to Home; the location hook still runs, so the hooks keep their order. */
  const creationLocation = enableLocationPicker
    ? location.phase === 'ready'
      ? location.value
      : undefined
    : homeProjectCreationLocation;
  const canCreate = enableLocationPicker ? location.canCreate : true;

  /* Mount autofocus alone misses a return to an already-mounted Home, so honour a
   * navigation that asks for focus (`state.focusChatComposer`) too. */
  const { key: locationKey, state: locationState } = useLocation() as {
    key: string;
    state: unknown;
  };
  // Each navigation that asks for focus is its own request, identified by its location key.
  const focusRequestKey =
    (locationState as { focusChatComposer?: unknown } | undefined)?.focusChatComposer === true
      ? locationKey
      : undefined;
  useEffect(() => {
    if (enableAutoFocus && focusRequestKey !== undefined) {
      focusComposer();
    }
  }, [enableAutoFocus, focusComposer, focusRequestKey]);

  /* Returning to the window restores the last focused element; when that is
   * nothing, the draft is what the user came back for. */
  useEffect(() => {
    if (!enableAutoFocus) {
      return undefined;
    }
    const handleWindowFocus = (): void => {
      if (document.activeElement === null || document.activeElement === document.body) {
        focusComposer();
      }
    };
    globalThis.addEventListener('focus', handleWindowFocus);
    return () => {
      globalThis.removeEventListener('focus', handleWindowFocus);
    };
  }, [enableAutoFocus, focusComposer]);

  const creationLocationControl = useMemo(
    () =>
      enableLocationPicker && location.shouldShowPicker ? (
        <WorkspaceSelector
          data-chat-textarea-focustrap
          state={location}
          variant='toolbar'
          onSelectionComplete={focusComposer}
          onRequestFocus={focusComposer}
        />
      ) : undefined,
    [enableLocationPicker, focusComposer, location],
  );

  const onSubmit: ChatTextareaProperties['onSubmit'] = useCallback(
    async ({ content }) => {
      if (creationLocation === undefined) {
        return;
      }
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

  return (
    <div className='space-y-4'>
      <ChatTextarea
        ref={textareaRef}
        enableAutoFocus={enableAutoFocus}
        enableContextActions={false}
        creationLocationControl={creationLocationControl}
        isSubmitDisabled={!canCreate}
        // SinopiaCAD: the home's prompt (UI-UX-SinopiaCAD §2.4); the project's asks for a change.
        placeholder={t('home.composerPlaceholder')}
        className={className}
        onSubmit={onSubmit}
      />
    </div>
  );
}
