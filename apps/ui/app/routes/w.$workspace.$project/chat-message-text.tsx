import type { TextUIPart } from 'ai';
import { memo, useMemo } from 'react';
import { AgentVariantsBlock } from '#components/chat/assistant-tray.js';
import { MarkdownViewerChat } from '#components/markdown/markdown-viewer-chat.js';
import { linguaggioVarianti, separaVarianti } from '#lib/assistant-variants-marker.js';

export const ChatMessageText = memo(function ({
  part,
  isMessageActive,
}: {
  readonly part: TextUIPart;
  readonly isMessageActive: boolean;
}): React.JSX.Element {
  const isStreaming = isMessageActive && part.state !== 'done';
  // SinopiaCAD D5: the agent's own variants arrive as a `sinopia-varianti` block and show as the variants card.
  const parti = useMemo(
    () => (part.text.includes(`\`\`\`${linguaggioVarianti}`) ? separaVarianti(part.text) : undefined),
    [part.text],
  );
  if (parti) {
    return (
      <>
        {parti.map((parte, indice) =>
          parte.tipo === 'testo' ? (
            // oxlint-disable-next-line react/no-array-index-key -- the pieces of one answer keep their order.
            <MarkdownViewerChat key={indice} className='my-1' isStreaming={isStreaming} isStreamingFade={isStreaming}>
              {parte.testo}
            </MarkdownViewerChat>
          ) : (
            // oxlint-disable-next-line react/no-array-index-key -- the pieces of one answer keep their order.
            <AgentVariantsBlock key={indice} blocco={parte.blocco} />
          ),
        )}
      </>
    );
  }
  return (
    <MarkdownViewerChat className='my-1' isStreaming={isStreaming} isStreamingFade={isStreaming}>
      {part.text}
    </MarkdownViewerChat>
  );
});
