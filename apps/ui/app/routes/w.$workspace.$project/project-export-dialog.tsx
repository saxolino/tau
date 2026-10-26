import { useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { useTranslation } from '#i18n/translate.js';
import { useProject } from '#hooks/use-project.js';
import { useProjectExport } from '#hooks/use-project-export.js';
import { useChatSessionStore } from '#hooks/chat-session-store-provider.js';
import { toast } from '#components/ui/sonner.js';
import { ExportDialogView } from '#routes/w.$workspace.$project/project-export-dialog-view.js';

export function ProjectExportDialog({
  onOpenChange,
  onShowAgent,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onShowAgent: () => void;
}): React.JSX.Element {
  const { projectRef, editorRef } = useProject();
  const name = useSelector(projectRef, (state) => state.context.project?.name) ?? '';
  const store = useChatSessionStore();
  const { t } = useTranslation();
  const { pieces, sketches, prepare, capturePhoto } = useProjectExport();
  const askAgent = useCallback(
    (message: string): void => {
      const chatId = editorRef.getSnapshot().context.focusedChatId;
      const session = chatId ? store.get(chatId) : undefined;
      if (!session) {
        toast.error(t('export.draftUnavailable'));
        onShowAgent();
        return;
      }
      const existing = session.draftActorRef.getSnapshot().context.draftText;
      session.draftActorRef.send({ type: 'setDraftText', text: existing ? `${existing}\n\n${message}` : message });
      onOpenChange(false);
      onShowAgent();
    },
    [editorRef, onOpenChange, onShowAgent, store, t],
  );
  return (
    <ExportDialogView
      name={name}
      pieces={pieces}
      sketches={sketches}
      prepare={prepare}
      capture={capturePhoto}
      onAskAgent={askAgent}
      onOpenChange={onOpenChange}
    />
  );
}
