import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { useIsMobile } from '@taucad/ui/hooks/use-mobile';
import { NewProjectChatComposer } from '#components/chat/new-project-chat-composer.js';
import type { ChatTextareaHandle } from '#components/chat/chat-textarea-types.js';
import { getClipboardImageFiles } from '#components/chat/chat-paste-handler.js';
import { toast } from '#components/ui/sonner.js';
import { HomeNewProjectComposerProvider } from '#hooks/active-chat-provider.js';
import { useAgentLaneOpen } from '#hooks/use-agent-lane-open.js';
import {
  AgentLaneToggleButton,
  toggleChatKeyCombination,
} from '#routes/w.$workspace.$project/agent-lane-toggle-button.js';
import { HomeAgentLane } from '#routes/_index/home-agent-lane.js';
import { HomeImageDropZone } from '#routes/_index/home-image-drop-zone.js';
import { HomeRecentProjects } from '#routes/_index/home-recent-projects.js';
import { useHomeImageIntake } from '#routes/_index/use-home-image-intake.js';

const hasFiles = (dataTransfer: DataTransfer): boolean => dataTransfer.types.includes('Files');

/** A paste into a field belongs to that field (the composer reads its own pictures). */
const isEditableTarget = (target: unknown): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;

const announcementFor = (count: number): string =>
  count === 1
    ? 'Immagine allegata al messaggio per l’agente.'
    : `${count} immagini allegate al messaggio per l’agente.`;

/**
 * The home inside its composer provider: the main area (the «Dall'immagine al CAD» drop zone and «I tuoi progetti»)
 * beside the agent lane. Pictures dropped anywhere on the page, pasted with nothing editable focused, or chosen with
 * the picker go into the agent composer's draft; the lane then opens and the composer takes focus for the words.
 *
 * @returns The home.
 */
function HomeSurface(): React.JSX.Element {
  const isMobile = useIsMobile();
  const [isLaneOpen, setLaneOpen] = useAgentLaneOpen();
  const isLaneShown = isLaneOpen && !isMobile;
  const composerRef = useRef<ChatTextareaHandle>(null);
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
      const added = await addImages(files);
      if (added === 0) {
        return;
      }
      setAnnouncement(announcementFor(added));
      setLaneOpen(true);
      // A lane that was closed mounts its composer with autofocus; an open one is focused here.
      requestAnimationFrame(() => {
        composerRef.current?.focus();
      });
    },
    [addImages, setLaneOpen],
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
        toast.error('Questa immagine arriva da una pagina web', {
          description: 'Salvala sul computer, poi trascinala qui o sceglila.',
        });
      }
    },
    [takeImages],
  );

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- drag and drop has keyboard equivalents: the picker button and ⌘V
    <div
      className='flex size-full min-h-0'
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* The main area plays the viewer's part beside the lane, so the closed lane's toggle folds the same way. */}
      <div className='@container/viewer relative flex min-w-0 flex-1 flex-col overflow-y-auto'>
        {isMobile ? null : (
          <div className='sticky top-0 z-10 flex h-9 shrink-0 items-center justify-end px-1'>
            {isLaneShown ? null : <AgentLaneToggleButton place='viewer' isOpen={false} onOpenChange={setLaneOpen} />}
          </div>
        )}
        <div className='container mx-auto flex flex-col px-4'>
          <HomeImageDropZone
            isDragging={isDragging}
            onChooseFiles={(files) => {
              void takeImages(files);
            }}
          />
          {isMobile ? (
            <div role='region' aria-label='Messaggio per l’agente' className='mx-auto mt-6 w-full max-w-3xl'>
              <NewProjectChatComposer ref={composerRef} enableAutoFocus={false} enableLocationPicker={false} />
            </div>
          ) : null}
          <HomeRecentProjects />
        </div>
      </div>
      {isLaneShown ? (
        <aside aria-label='Agente' className='w-80 shrink-0 border-l border-border'>
          <HomeAgentLane composerRef={composerRef} onOpenChange={setLaneOpen} />
        </aside>
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
  return (
    <HomeNewProjectComposerProvider>
      <HomeSurface />
    </HomeNewProjectComposerProvider>
  );
}
