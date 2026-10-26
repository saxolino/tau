import { useTranslation } from '#i18n/translate.js';
import { cn } from '@taucad/ui/utils/cn';
import { AssistantStarts } from '#components/chat/assistant-suggestions.js';
import { useSelectedPiece } from '#hooks/use-selected-piece.js';

/** An empty conversation offers three ways to start, not a greeting (Fable 26 ott §2.3). */
export function ChatHistoryEmpty({ className }: { readonly className?: string }): React.JSX.Element {
  const { t } = useTranslation();
  const hasSelection = useSelectedPiece() !== undefined;
  return (
    <div className={cn('my-auto w-full max-w-sm py-6', className)}>
      <h2 className='text-lg leading-tight font-medium text-foreground'>{t('inspector.assistant.startsTitle')}</h2>
      <p className='mt-2 mb-4 text-sm leading-relaxed text-muted-foreground'>{t('inspector.assistant.startsText')}</p>
      <AssistantStarts />
      {hasSelection ? null : (
        <p className='mt-5 border-t pt-3 text-xs leading-relaxed text-muted-foreground'>
          {t('project.agent.contextHint')}
        </p>
      )}
    </div>
  );
}
