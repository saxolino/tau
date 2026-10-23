import { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { useLocation } from 'react-router';
import { ChatTextarea } from '#components/chat/chat-textarea.js';
import type { ChatTextareaHandle, ChatTextareaProperties } from '#components/chat/chat-textarea-types.js';
import { WorkspaceSelector } from '#components/filesystem/workspace-selector.js';
import { useTranslation } from '#i18n/translate.js';

import { useNewProjectSubmit } from '#components/chat/use-new-project-submit.js';

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
  /** A shared home submission, also used by the image hero. */
  readonly onSubmit?: ChatTextareaProperties['onSubmit'];
  readonly isSubmitDisabled?: boolean;
};

/** Shared direct-create composer rendered inside an existing chat provider. */
export function NewProjectChatComposer({
  ref,
  enableAutoFocus = true,
  enableLocationPicker = true,
  className,
  onSubmit: sharedSubmit,
  isSubmitDisabled = false,
}: NewProjectChatComposerProperties): React.JSX.Element {
  const { t } = useTranslation();
  const textareaRef = useRef<ChatTextareaHandle>(null);
  const { onSubmit, isSubmitting, location, canCreate } = useNewProjectSubmit(enableLocationPicker);

  const focusComposer = useCallback((): void => {
    textareaRef.current?.focus();
  }, []);
  useImperativeHandle(
    ref,
    () => ({ focus: focusComposer, submit: (): Promise<void> | undefined => textareaRef.current?.submit?.() }),
    [focusComposer],
  );
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

  return (
    <div className='space-y-4' inert={isSubmitDisabled || isSubmitting} aria-busy={isSubmitDisabled || isSubmitting}>
      <ChatTextarea
        ref={textareaRef}
        enableAutoFocus={enableAutoFocus}
        enableContextActions={false}
        creationLocationControl={creationLocationControl}
        isSubmitDisabled={!canCreate || isSubmitting || isSubmitDisabled}
        enableAgentControls={enableLocationPicker}
        // SinopiaCAD: the home's prompt (UI-UX-SinopiaCAD §2.4); the project's asks for a change.
        placeholder={t('home.composerPlaceholder')}
        className={className}
        onSubmit={sharedSubmit ?? onSubmit}
      />
    </div>
  );
}
