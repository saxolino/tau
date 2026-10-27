import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { FileText, FolderOpen, ImagePlus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { cn } from '@taucad/ui/utils/cn';
import { useDraftActions } from '#hooks/use-chat.js';
import { useInspectorSelection } from '#hooks/use-inspector-selection.js';
import { useSinopiaSession } from '#hooks/use-sinopia-session.js';
import { useTranslation } from '#i18n/translate.js';
import { contextualSuggestions } from '#lib/inspector-selection.js';
import { homeImageAccept, useHomeImageIntake } from '#routes/_index/use-home-image-intake.js';
import { SinopiaProjectStrip } from '#routes/_index/sinopia-project-strip.js';

/** How a suggestion or a start reaches the composer it fills: the composer of the dock or of the conversation. */
type AssistantComposer = Readonly<{ focusComposer: () => void }>;

const AssistantComposerContext = createContext<AssistantComposer>({ focusComposer: () => undefined });

/**
 * The composer a suggestion fills: the dock's or the conversation's.
 *
 * @returns How to focus it.
 */
export function useAssistantComposer(): AssistantComposer {
  return useContext(AssistantComposerContext);
}

/**
 * Provide the composer a suggestion fills.
 *
 * @param props - The composer's focus and the content that offers suggestions.
 * @returns The provider.
 */
export function AssistantComposerProvider({
  focusComposer,
  children,
}: Readonly<{ focusComposer: () => void; children: React.ReactNode }>): React.JSX.Element {
  const value = useMemo(() => ({ focusComposer }), [focusComposer]);
  return <AssistantComposerContext.Provider value={value}>{children}</AssistantComposerContext.Provider>;
}

/**
 * Two or three edits for what is selected, as chips. A chip fills the composer with its sentence, numbers read from
 * the selection's geometry, and leaves the sending to the person: the agent never acts on a single click.
 *
 * @param props - Extra classes.
 * @returns The chips.
 */
export function AssistantContextChips({ className }: { readonly className?: string }): React.JSX.Element {
  const { t, language } = useTranslation();
  const { selection } = useInspectorSelection();
  const { setDraftText } = useDraftActions();
  const { focusComposer } = useContext(AssistantComposerContext);
  const suggestions = useMemo(() => contextualSuggestions(selection, t, language), [selection, t, language]);
  return (
    <div
      role='group'
      aria-label={t('inspector.assistant.suggestions')}
      data-slot='assistant-context-chips'
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {suggestions.map((suggestion) => (
        <Button
          key={suggestion}
          variant='outline'
          size='xs'
          className='h-auto min-h-7 max-w-full justify-start rounded-lg py-1 text-left leading-snug font-normal whitespace-normal'
          onClick={() => {
            setDraftText(suggestion);
            focusComposer();
          }}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  );
}

function StartButton({
  icon: Icon,
  label,
  hint,
  disabledReason,
  isCompact,
  onClick,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  hint: string;
  disabledReason?: string;
  isCompact: boolean;
  onClick: () => void;
}>): React.JSX.Element {
  if (isCompact) {
    // Under the inspector the starts are one row; their explanation is the tooltip.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant='outline'
            size='xs'
            aria-disabled={disabledReason === undefined ? undefined : true}
            className={cn('rounded-full', disabledReason !== undefined && 'opacity-55')}
            onClick={() => {
              if (disabledReason === undefined) {
                onClick();
              }
            }}
          >
            <Icon aria-hidden className='size-3.5 text-titanium-foreground' />
            {label}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{disabledReason ?? hint}</TooltipContent>
      </Tooltip>
    );
  }
  const button = (
    <button
      type='button'
      aria-disabled={disabledReason === undefined ? undefined : true}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left hover:bg-accent focus-visible:focus-outline',
        disabledReason !== undefined && 'cursor-default opacity-55 hover:bg-background',
      )}
      onClick={() => {
        if (disabledReason === undefined) {
          onClick();
        }
      }}
    >
      <Icon aria-hidden className='mt-0.5 size-4 shrink-0 text-titanium-foreground' />
      <span className='min-w-0'>
        <span className='block text-sm leading-5 font-medium'>{label}</span>
        <span className='block text-xs leading-snug text-muted-foreground'>{disabledReason ?? hint}</span>
      </span>
    </button>
  );
  return disabledReason === undefined ? (
    button
  ) : (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The assistant's empty state: three ways to start, not a greeting. An image goes into the composer's draft (the
 * home's own intake, with its checks), a description opens the composer, a Sinopia project opens the home's picker.
 *
 * @param props - Extra classes.
 * @returns The three starts.
 */
export function AssistantStarts({
  className,
  variant = 'cards',
}: {
  readonly className?: string;
  /** `cards` in the empty conversation; `row` in the strip under the inspector. */
  readonly variant?: 'cards' | 'row';
}): React.JSX.Element {
  const isCompact = variant === 'row';
  const { t } = useTranslation();
  const { focusComposer } = useContext(AssistantComposerContext);
  const { setDraftText } = useDraftActions();
  const { addImages, canReadImages } = useHomeImageIntake();
  const session = useSinopiaSession();
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className={cn(isCompact ? 'flex flex-wrap gap-1.5' : 'space-y-2', className)} data-slot='assistant-starts'>
      <StartButton
        icon={ImagePlus}
        label={t('inspector.assistant.fromImage')}
        hint={t('inspector.assistant.fromImageHint')}
        disabledReason={canReadImages ? undefined : t('inspector.assistant.imagesUnsupported')}
        isCompact={isCompact}
        onClick={() => {
          fileInput.current?.click();
        }}
      />
      <StartButton
        icon={FileText}
        label={t('inspector.assistant.fromDescription')}
        hint={t('inspector.assistant.fromDescriptionHint')}
        isCompact={isCompact}
        onClick={() => {
          setDraftText(t('inspector.assistant.fromDescriptionDraft'));
          focusComposer();
        }}
      />
      <StartButton
        icon={FolderOpen}
        label={t('inspector.assistant.fromSinopia')}
        hint={t('inspector.assistant.fromSinopiaHint')}
        disabledReason={
          session.status === 'signed-in'
            ? canReadImages
              ? undefined
              : t('inspector.assistant.imagesUnsupported')
            : t('inspector.assistant.fromSinopiaSignedOut')
        }
        isCompact={isCompact}
        onClick={() => {
          setIsPickerOpen(true);
        }}
      />
      <input
        ref={fileInput}
        type='file'
        accept={homeImageAccept}
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={async (event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if ((await addImages(files)) > 0) {
            focusComposer();
          }
        }}
      />
      {/* The home's picker and image sheet, without its strip: the sheets portal out of this hidden box. */}
      <div hidden>
        <SinopiaProjectStrip
          isPickerOpen={isPickerOpen}
          onPickerOpenChange={setIsPickerOpen}
          onChoose={async (chosen) => {
            if ((await addImages(chosen.files)) > 0) {
              focusComposer();
            }
          }}
        />
      </div>
    </div>
  );
}
