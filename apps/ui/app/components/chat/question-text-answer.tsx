import { useCallback, useEffect, useId, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Textarea } from '@taucad/ui/components/textarea';
import { DictationButton, DictationFeedback, DictationRecording } from '#components/dictation/dictation-controls.js';
import { useDictation } from '#components/dictation/use-dictation.js';

/** Own-words reply. Dictation edits the draft; sending remains an explicit action after transcription. */
export function QuestionTextAnswer({
  draft,
  onDraftChange,
  isOpen,
  shouldTakeFocus,
  placeholder,
  onHold,
  onAnswer,
  onDismiss,
}: {
  readonly draft: string;
  readonly onDraftChange: Dispatch<SetStateAction<string>>;
  readonly isOpen: boolean;
  readonly shouldTakeFocus: boolean;
  readonly placeholder: string;
  readonly onHold: () => void;
  readonly onAnswer: (text: string) => void;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const textId = useId();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const insertTranscript = useCallback(
    (text: string): void => {
      onDraftChange((previous) => `${previous}${previous === '' || /\s$/u.test(previous) ? '' : ' '}${text}`);
      textRef.current?.focus();
    },
    [onDraftChange],
  );
  const dictation = useDictation(insertTranscript, textId);
  const isDictating = dictation.phase !== 'idle';
  const start = useCallback(async (): Promise<void> => {
    onHold();
    await dictation.start();
  }, [dictation.start, onHold]);
  const send = (): void => {
    const text = draft.trim();
    if (isOpen && !isDictating && text !== '') {
      onAnswer(text);
    }
  };
  useEffect(() => {
    if (shouldTakeFocus) {
      textRef.current?.focus();
    }
  }, [shouldTakeFocus]);

  return (
    <div
      className='flex min-w-0 flex-1 flex-col gap-1'
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          if (isDictating) {
            dictation.cancel();
            textRef.current?.focus();
          } else {
            onDismiss();
          }
        }
      }}
    >
      <div className='flex min-w-0 items-end gap-1'>
        <label htmlFor={textId} className='sr-only'>
          Your answer
        </label>
        <Textarea
          ref={textRef}
          id={textId}
          rows={1}
          value={draft}
          disabled={!isOpen}
          placeholder={placeholder}
          className='min-h-8 resize-none py-1.5'
          onFocus={onHold}
          onChange={(event) => {
            onDraftChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        {dictation.available === true && isOpen ? (
          <DictationButton phase={dictation.phase} onStart={start} onStop={dictation.stop} />
        ) : null}
        <Button
          type='button'
          size='icon-sm'
          variant='outline'
          aria-label='Send answer'
          disabled={!isOpen || isDictating || draft.trim() === ''}
          onClick={send}
        >
          <ArrowUp aria-hidden='true' />
        </Button>
      </div>
      {isDictating ? (
        <div className='flex min-w-0 items-center gap-1'>
          <DictationRecording phase={dictation.phase} levels={dictation.levels} onCancel={dictation.cancel} />
        </div>
      ) : null}
      <DictationFeedback transcript={dictation.transcript} error={dictation.error} />
    </div>
  );
}
