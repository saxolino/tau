import { memo } from 'react';
import { ArrowUp, Play } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import { Loader } from '@taucad/ui/components/loader';
import { useTranslation } from '#i18n/translate.js';
import { cn } from '@taucad/ui/utils/cn';

/** Monochrome action treatment shared by the composer and question replies. */
export const chatComposerActionButtonClassName =
  'rounded-full bg-foreground text-background shadow-xs hover:bg-foreground/85 hover:text-background dark:bg-foreground dark:text-background dark:hover:bg-foreground/85 dark:hover:text-background';

type ChatTextareaSubmitButtonProperties = {
  readonly status: string;
  readonly canResume?: boolean;
  readonly isSubmitting: boolean;
  /** Why Send refuses right now, or `undefined` when it would send. */
  readonly refusal: string | undefined;
  /** The id of the text beside the attachments saying why Send refuses, when there is one (S14). */
  readonly describedBy?: string;
  readonly formattedCancelKeyCombination: string;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
};

/**
 * Send a draft, queue it during a turn, or resume interrupted work.
 *
 * A refusing Send stays focusable (F14): it is `aria-disabled`, not
 * `disabled`, so a keyboard reaches it and its tooltip says why.
 */
export const ChatTextareaSubmitButton = memo(function ({
  status,
  canResume = false,
  isSubmitting,
  refusal,
  describedBy,
  onSubmit,
}: ChatTextareaSubmitButtonProperties): React.JSX.Element {
  const { t } = useTranslation();
  const isLive = ['streaming', 'submitted'].includes(status);
  const label = !isLive && canResume ? t('project.agent.resume') : t('project.agent.send');
  const icon =
    !isLive && canResume ? (
      <Play aria-hidden='true' className='fill-current' />
    ) : (
      <ArrowUp aria-hidden='true' className='size-5' />
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type='button'
          variant='ghost'
          size={!isLive && canResume ? 'sm' : 'icon-sm'}
          aria-label={label}
          aria-keyshortcuts='Enter'
          aria-disabled={refusal !== undefined}
          className={cn(
            chatComposerActionButtonClassName,
            'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-foreground',
          )}
          // Only when set: an explicit `undefined` would replace the tooltip's own description.
          {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
          onClick={() => {
            if (refusal === undefined) {
              onSubmit();
            }
          }}
        >
          {isSubmitting ? <Loader className='size-4' /> : icon}
          {!isLive && canResume ? label : undefined}
        </Button>
      </TooltipTrigger>
      <TooltipContent className='flex items-center gap-2 align-baseline'>
        {refusal ?? (
          <>
            {label} <KeyShortcut variant='tooltip'>{formatKeyCombination({ key: 'Enter' })}</KeyShortcut>
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
});
