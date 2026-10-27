import { useCadViewport } from '#hooks/use-cad-viewport.js';
import { CadPhoneNotice } from '#components/layout/cad-phone-notice.js';
import { TabletLane } from '#components/layout/tablet-lane.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { useIsMobile } from '@taucad/ui/hooks/use-mobile';
import { NewProjectChatComposer } from '#components/chat/new-project-chat-composer.js';
import type { ChatTextareaHandle, ChatTextareaProperties } from '#components/chat/chat-textarea-types.js';
import { getClipboardImageFiles } from '#components/chat/chat-paste-handler.js';
import { toast } from '#components/ui/sonner.js';
import { useTranslation } from '#i18n/translate.js';
import { attachmentModelForExecution, attachmentSendBlockReason } from '#utils/chat.utils.js';
import { HomeNewProjectComposerProvider, useChatComposer } from '#hooks/active-chat-provider.js';
import { useAgentLaneOpen } from '#hooks/use-agent-lane-open.js';
import {
  AgentLaneToggleButton,
  toggleChatKeyCombination,
} from '#routes/w.$workspace.$project/agent-lane-toggle-button.js';
import { HomeAgentLane } from '#routes/_index/home-agent-lane.js';
import { useNewProjectSubmit } from '#components/chat/use-new-project-submit.js';
import { useDraftActions, useDraftSelector } from '#hooks/use-chat.js';
import { HomeHero } from '#routes/_index/home-hero.js';
import { HomeHeroExample } from '#routes/_index/home-hero-example.js';
import { HomeImageDropZone } from '#routes/_index/home-image-drop-zone.js';
import { HomeRecentProjects } from '#routes/_index/home-recent-projects.js';
import { useHomeImageIntake } from '#routes/_index/use-home-image-intake.js';

import { SinopiaProjectStrip } from '#routes/_index/sinopia-project-strip.js';
import { OpenSinopiaModelFromLink, useSinopiaEntryLink } from '#routes/_index/sinopia-entry-link.js';
import type { SinopiaReferenceSelection } from '#services/sinopia-references.js';

const hasFiles = (dataTransfer: DataTransfer): boolean => dataTransfer.types.includes('Files');

/** A paste into a field belongs to that field (the composer reads its own pictures). */
const isEditableTarget = (target: unknown): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;

/**
 * The home inside its composer provider: the main area (the «Dall'immagine al CAD» drop zone and «I tuoi progetti»)
 * beside the agent lane. Pictures dropped anywhere on the page, pasted with nothing editable focused, or chosen with
 * the picker go into the agent composer's draft; the lane then opens and the composer takes focus for the words.
 *
 * @returns The home.
 */
function HomeSurface(): React.JSX.Element {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isTablet = useCadViewport() === 'tablet';
  const [isLaneOpen, setLaneOpen] = useAgentLaneOpen();
  const isLaneShown = isLaneOpen && (!isMobile || isTablet);
  const [measure, setMeasure] = useState('');
  const [references, setReferences] = useState<SinopiaReferenceSelection>();
  const [isSinopiaPickerOpen, setSinopiaPickerOpen] = useState(false);
  // Sinopia's «Apri nel CAD» links: `?project=<id>` and `?model=<id>`.
  const entry = useSinopiaEntryLink();
  const { consume } = entry;
  const spendProjectLink = useCallback((): void => {
    consume('project');
  }, [consume]);
  const spendModelLink = useCallback((): void => {
    consume('model');
  }, [consume]);
  const { onSubmit, isSubmitting, rememberReferences } = useNewProjectSubmit(false, references);
  const {
    model: { model },
    execution: { execution },
  } = useChatComposer();
  const draftAttachments = useDraftSelector((state) => state.draftAttachments);
  const isAttaching = useDraftSelector((state) => state.attachingMain);
  const sendBlockReason = attachmentSendBlockReason(draftAttachments, attachmentModelForExecution(execution, model));
  const draftText = useDraftSelector((state) => state.draftText);
  const hasImages = useDraftSelector((state) =>
    state.draftAttachments.some((attachment) => attachment.mediaType.startsWith('image/')),
  );
  const submitHome: ChatTextareaProperties['onSubmit'] = useCallback(
    async (payload) => {
      const content = [
        payload.content.trim() || (hasImages ? t('home.dropZone.buildPrompt') : ''),
        hasImages && measure.trim() ? t('home.dropZone.knownMeasure', { measure: measure.trim() }) : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      await onSubmit({ ...payload, content });
    },
    [hasImages, measure, onSubmit, t],
  );
  if (!hasImages && measure !== '') {
    setMeasure('');
  }
  const build = (): void => {
    if (!hasImages || isAttaching || sendBlockReason !== undefined) {
      return;
    }
    const editorSubmission = composerRef.current?.submit?.();
    if (editorSubmission !== undefined) {
      void editorSubmission;
      return;
    }
    void submitHome({ content: draftText.trim() || t('home.dropZone.buildPrompt'), attachments: [] });
  };
  const composerRef = useRef<ChatTextareaHandle>(null);
  const { setDraftText } = useDraftActions();
  // The third way in: words. The lane opens and its composer takes focus (a closed lane mounts it with autofocus).
  const describe = useCallback((): void => {
    setLaneOpen(true);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
    });
  }, [setLaneOpen]);
  // The hero's example is the assistant's own buckle proposal: trying it puts those words in the composer.
  const tryExample = useCallback((): void => {
    setDraftText(t('home.agentLane.buckle'));
    describe();
  }, [describe, setDraftText, t]);
  const { addImages } = useHomeImageIntake();
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const [announcement, setAnnouncement] = useState('');

  const toggleLane = useCallback((): void => {
    setLaneOpen((isOpen) => !isOpen);
  }, [setLaneOpen]);
  // ⌃C, as on the project page; the lane's toggle advertises it.
  useKeybinding(toggleChatKeyCombination, toggleLane, { enabled: !isMobile });

  const takeImages = useCallback(
    async (files: Iterable<File>): Promise<void> => {
      if (isSubmitting) {
        return;
      }
      const added = await addImages(files);
      if (added === 0) {
        return;
      }
      setAnnouncement(added === 1 ? t('home.intake.announceOne') : t('home.intake.announceMany', { count: added }));
      setLaneOpen(true);
      // A lane that was closed mounts its composer with autofocus; an open one is focused here.
      requestAnimationFrame(() => {
        composerRef.current?.focus();
      });
    },
    [addImages, isSubmitting, setLaneOpen, t],
  );

  const takeSinopiaImages = useCallback(
    async (selection: SinopiaReferenceSelection): Promise<void> => {
      if (isSubmitting) {
        return;
      }
      const added = await addImages(selection.files);
      if (added === 0) {
        throw new Error('No reference images accepted');
      }
      const merged = await rememberReferences(selection);
      setReferences(merged);
      setLaneOpen(true);
      setAnnouncement(t('home.intake.announceMany', { count: added }));
      requestAnimationFrame(() => {
        composerRef.current?.focus();
      });
    },
    [addImages, isSubmitting, rememberReferences, setLaneOpen, t],
  );

  useEffect(() => {
    const takePastedImages = (event: ClipboardEvent): void => {
      if (event.defaultPrevented || isEditableTarget(event.target)) {
        return;
      }
      const files = getClipboardImageFiles(event.clipboardData ?? undefined);
      if (files.length === 0) {
        return;
      }
      event.preventDefault();
      void takeImages(files);
    };
    document.addEventListener('paste', takePastedImages);
    return () => {
      document.removeEventListener('paste', takePastedImages);
    };
  }, [takeImages]);

  const handleDragEnter = useCallback((event: React.DragEvent): void => {
    if (!hasFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }, []);
  const handleDragOver = useCallback((event: React.DragEvent): void => {
    if (!hasFiles(event.dataTransfer)) {
      return;
    }
    // Without this the browser would open the dropped file in place of SinopiaCAD.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);
  const handleDragLeave = useCallback((): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDragging(false);
    }
  }, []);
  const handleDrop = useCallback(
    (event: React.DragEvent): void => {
      dragDepth.current = 0;
      setIsDragging(false);
      // The composer takes a drop on itself, into the same draft.
      if (event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      const files = [...event.dataTransfer.files];
      if (files.length > 0) {
        void takeImages(files);
      } else if (event.dataTransfer.types.includes('text/uri-list')) {
        toast.error(t('home.intake.fromWebPage'), {
          description: t('home.intake.fromWebPageHint'),
        });
      }
    },
    [t, takeImages],
  );

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- drag and drop has keyboard equivalents: the picker button and ⌘V
    <div
      className='relative flex size-full min-h-0 overflow-hidden'
      data-cad-home
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* The main area plays the viewer's part beside the lane, so the closed lane's toggle folds the same way. */}
      <div className='@container/viewer relative flex min-w-0 flex-1 flex-col overflow-y-auto'>
        {isMobile && !isTablet ? null : (
          <div className='sticky top-0 z-10 flex h-12 shrink-0 items-center justify-end px-1'>
            {isLaneShown && !isTablet ? null : (
              <AgentLaneToggleButton place='viewer' isOpen={false} onOpenChange={setLaneOpen} />
            )}
          </div>
        )}
        <div className='mx-auto flex w-full max-w-6xl flex-col px-6 pb-6 lg:px-8'>
          <HomeHero
            intake={
              <HomeImageDropZone
                onChooseSinopia={() => {
                  setSinopiaPickerOpen(true);
                }}
                onDescribe={describe}
                isDragging={isDragging}
                measure={measure}
                onMeasureChange={setMeasure}
                onBuild={build}
                isSubmitting={isSubmitting}
                submitError={sendBlockReason === undefined ? undefined : t('home.composer.attachmentsBlocked')}
                onChooseFiles={(files) => {
                  void takeImages(files);
                }}
              />
            }
            example={<HomeHeroExample onTryExample={tryExample} />}
          />
          {isMobile && !isTablet ? (
            <div role='region' aria-label={t('home.intake.messageForAgent')} className='mx-auto mt-6 w-full max-w-3xl'>
              <NewProjectChatComposer
                ref={composerRef}
                enableAutoFocus={false}
                enableLocationPicker={false}
                onSubmit={submitHome}
                isSubmitDisabled={isSubmitting}
              />
            </div>
          ) : null}
          <HomeRecentProjects />
          {entry.modelId === undefined ? null : (
            <OpenSinopiaModelFromLink modelId={entry.modelId} onSpent={spendModelLink} />
          )}
          <SinopiaProjectStrip
            preselectProjectId={entry.projectId}
            onPreselectHandled={spendProjectLink}
            onChoose={takeSinopiaImages}
            isPickerOpen={isSinopiaPickerOpen}
            onPickerOpenChange={setSinopiaPickerOpen}
          />
        </div>
      </div>
      {isLaneShown && !isTablet ? (
        <aside aria-label={t('home.agentLane.label')} className='w-80 shrink-0 border-l border-border xl:w-90'>
          <HomeAgentLane
            composerRef={composerRef}
            onOpenChange={setLaneOpen}
            onSubmit={submitHome}
            isSubmitting={isSubmitting}
          />
        </aside>
      ) : null}
      {isTablet && isLaneShown ? (
        <TabletLane
          label={t('home.agentLane.label')}
          side='right'
          onClose={() => {
            setLaneOpen(false);
          }}
        >
          <HomeAgentLane
            composerRef={composerRef}
            onOpenChange={setLaneOpen}
            onSubmit={submitHome}
            isSubmitting={isSubmitting}
          />
        </TabletLane>
      ) : null}
      <p role='status' aria-live='polite' className='sr-only'>
        {announcement}
      </p>
    </div>
  );
}

/**
 * SinopiaCAD's home: from a picture to the CAD, with the agent beside it as on the project page. Everything the home
 * gathers (pictures and words) lives in one draft, the home composer's durable record, and the first message sent
 * creates the project and opens it with that message as its chat's first turn.
 *
 * @returns The home.
 */
export function SinopiaHome(): React.JSX.Element {
  const viewport = useCadViewport();
  if (viewport === 'phone') {
    return <CadPhoneNotice />;
  }
  return (
    <HomeNewProjectComposerProvider>
      <HomeSurface />
    </HomeNewProjectComposerProvider>
  );
}
