import { cadReferenceFromGeometryComponent } from '@taucad/chat/references';
import { Button } from '@taucad/ui/components/button';
import { useState } from 'react';
import { useSelectedPiece } from '#hooks/use-selected-piece.js';
import { useChatSelector } from '#hooks/use-chat.js';
import { useCadChatClient } from '#chat-clients/use-cad-chat-client.js';
import { useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import { isStonePiece } from '#lib/piece-measures.js';

/** Contextual edits are actual messages with the selected piece's structured reference. */
export function AgentSuggestions(): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const selected = useSelectedPiece();
  const status = useChatSelector((state) => state.status);
  const hasAnswer = useChatSelector((state) =>
    state.messages.some(
      (message) =>
        message.role === 'assistant' && message.parts.some((part) => part.type === 'text' && part.text.trim() !== ''),
    ),
  );
  const client = useCadChatClient();
  const [sending, setSending] = useState(false);
  if (!hasAnswer || status === 'submitted' || status === 'streaming') {
    return undefined;
  }
  const keys: PlainMessageKey[] = selected
    ? isStonePiece(selected.node)
      ? ['agent.resize', 'agent.prongs', 'agent.rose']
      : ['agent.thinner', 'agent.smooth', 'agent.rose']
    : ['agent.describe', 'agent.measure', 'agent.rose'];
  return (
    <div aria-label={t('agent.suggestions')} className='mx-4 mb-2 flex flex-wrap gap-1'>
      {keys.map((key) => (
        <Button
          key={key}
          variant='outline'
          size='sm'
          className='h-auto min-h-8 whitespace-normal'
          disabled={sending}
          onClick={async () => {
            setSending(true);
            try {
              await client.submit({
                text: t(key),
                ...(selected?.reference ? { references: [cadReferenceFromGeometryComponent(selected.reference)] } : {}),
              });
            } catch {
              // The chat admission owner surfaces the actionable error.
            } finally {
              setSending(false);
            }
          }}
        >
          {t(key)}
        </Button>
      ))}
    </div>
  );
}
