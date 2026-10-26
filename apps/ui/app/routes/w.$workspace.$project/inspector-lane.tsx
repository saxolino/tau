import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelRight, PanelRightClose } from 'lucide-react';
import { KeyShortcut } from '@taucad/ui/components/key-shortcut';
import { useKeybinding } from '@taucad/ui/components/keyboard';
import { cn } from '@taucad/ui/utils/cn';
import { formatKeyCombination } from '@taucad/ui/utils/keys';
import type { KeyCombination } from '@taucad/ui/utils/keys';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { AssistantDock } from '#components/chat/assistant-dock.js';
import { useInspectorSelection } from '#hooks/use-inspector-selection.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { Language } from '#i18n/language.js';
import { pieceDimensions } from '#lib/inspector-selection.js';
import type { InspectorSelection, PieceDimensions } from '#lib/inspector-selection.js';
import { readablePieceName } from '#lib/piece-measures.js';
import { toggleChatKeyCombination } from '#routes/w.$workspace.$project/agent-lane-toggle-button.js';
import { useProjectParametersSource } from '#routes/w.$workspace.$project/chat-parameters.js';
import { useLaneToggleFocus } from '#routes/w.$workspace.$project/lane-toggle-focus.js';
import type { LaneTogglePlace } from '#routes/w.$workspace.$project/lane-toggle-focus.js';
import { InspectorPieceMeasures } from '#routes/w.$workspace.$project/piece-measures-pane.js';
import { useProjectWorkspace, useWorkspaceLanes } from '#routes/w.$workspace.$project/project-workspace-context.js';

/** ⌃J opens and closes the assistant's conversation under the inspector. */
export const toggleAssistantKeyCombination = { key: 'j', ctrlKey: true } satisfies KeyCombination;

/**
 * The right lane's toggle: in the top bar while the lane is hidden (labelled «Ispettore»), and at the end of the
 * inspector's header while it shows. ⌃C, the old agent lane's binding, keeps working.
 *
 * @param props - Which of the two mounts this is, and how a labelled mount folds to its glyph.
 * @returns The toggle.
 */
export function InspectorLaneToggle({
  place,
  fold,
}: {
  readonly place: LaneTogglePlace;
  readonly fold?: Readonly<{ className: string; labelClassName: string }>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { setChatOpen } = useProjectWorkspace();
  const { chat: isOpen } = useWorkspaceLanes();
  const { ref, claimFocus } = useLaneToggleFocus('chat', place, isOpen);
  const isInLane = place === 'lane';
  return (
    <PaneButton
      ref={ref}
      data-slot='inspector-lane-toggle'
      data-place={place}
      size={isInLane ? 'icon' : 'label'}
      aria-label={isInLane ? t('inspector.hide') : t('inspector.label')}
      aria-pressed={isInLane ? undefined : isOpen}
      aria-keyshortcuts='Control+C'
      className={cn('aria-pressed:text-foreground', !isInLane && fold?.className)}
      tooltipSide={isInLane ? 'left' : 'bottom'}
      tooltip={
        <span className='flex items-center gap-2'>
          {isOpen ? t('inspector.hide') : t('inspector.show')}
          <KeyShortcut variant='tooltip'>{formatKeyCombination(toggleChatKeyCombination)}</KeyShortcut>
        </span>
      }
      onClick={(event) => {
        claimFocus(event.currentTarget);
        setChatOpen(!isOpen);
      }}
    >
      {isInLane ? (
        <PanelRightClose aria-hidden className='size-3.5' />
      ) : (
        <>
          <PanelRight aria-hidden className='size-3.5' />
          <span className={fold?.labelClassName}>{t('inspector.label')}</span>
        </>
      )}
    </PaneButton>
  );
}

const sizeKeys = ['length', 'depth', 'height'] as const;

/** Parse a measure the way it is typed in either language: «36,5», "36.5". */
const parseMeasure = (text: string): number | undefined => {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/**
 * One size cell: the value in mono, editable when the piece can be scaled. Typing a new length scales the piece in
 * proportion about its centre; Enter applies, Esc puts the value back.
 */
function SizeCell({
  label,
  name,
  value,
  language,
  onScale,
}: Readonly<{
  label: string;
  name: string;
  value: number;
  language: Language;
  onScale?: (next: number) => Promise<boolean>;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const shown = formatNumber(value, language, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const [text, setText] = useState(shown);
  const [isEditing, setIsEditing] = useState(false);
  // Esc blurs the field too; that blur must put the value back, not apply what was typed.
  const isDiscarding = useRef(false);
  useEffect(() => {
    if (!isEditing) {
      // oxlint-disable-next-line react/set-state-in-effect -- The solid's new size replaces the cell's text between edits.
      setText(shown);
    }
  }, [shown, isEditing]);
  const commit = async (): Promise<void> => {
    setIsEditing(false);
    if (isDiscarding.current) {
      isDiscarding.current = false;
      setText(shown);
      return;
    }
    const next = parseMeasure(text);
    if (next === undefined || !onScale || Math.abs(next - value) < 1e-6) {
      setText(shown);
      return;
    }
    if (!(await onScale(next))) {
      setText(shown);
    }
  };
  return (
    <label className='flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-background px-2 py-1.5 focus-within:border-titanium'>
      <span className='font-mono text-[10px] leading-3 tracking-[0.18em] text-muted-foreground uppercase'>{label}</span>
      <span className='flex items-baseline gap-1'>
        <input
          aria-label={t('inspector.scaleTo', { measure: name.toLocaleLowerCase() })}
          title={onScale ? t('inspector.proportional') : undefined}
          readOnly={!onScale}
          inputMode='decimal'
          value={text}
          className='w-full min-w-0 bg-transparent font-mono text-sm leading-5 tabular-nums outline-none read-only:cursor-default'
          onFocus={() => {
            setIsEditing(true);
          }}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onBlur={() => {
            void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              isDiscarding.current = true;
              event.currentTarget.blur();
            }
          }}
        />
        <span className='font-mono text-[10px] text-muted-foreground'>mm</span>
      </span>
    </label>
  );
}

/** The selected piece's size from its solid, as three cells (L × P × A), editable in proportion when it can be. */
function PieceSize({
  size,
  pieceId,
  language,
}: Readonly<{ size: PieceDimensions; pieceId: string; language: Language }>): React.JSX.Element {
  const { t } = useTranslation();
  const workspace = useProjectWorkspace({ enableNoContext: true });
  const scalePiece = workspace?.scalePiece;
  const names = {
    length: t('inspector.lengthName'),
    depth: t('inspector.depthName'),
    height: t('inspector.heightName'),
  };
  return (
    <div className='space-y-1.5'>
      <div className='flex items-baseline justify-between gap-2'>
        <span className='text-xs text-muted-foreground' title={t('inspector.sizeHint')}>
          {t('inspector.size')}
          {size.exact ? '' : ' ≈'}
        </span>
        {scalePiece && size.exact ? (
          <span className='truncate text-[11px] text-muted-foreground'>{t('inspector.proportional')}</span>
        ) : null}
      </div>
      <div className='grid grid-cols-3 gap-1.5'>
        {sizeKeys.map((key) => (
          <SizeCell
            key={key}
            label={t(`inspector.${key}`)}
            name={names[key]}
            value={size[key]}
            language={language}
            onScale={
              scalePiece && size.exact && size[key] > 0
                ? async (next) => scalePiece(pieceId, next / size[key])
                : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

function selectionTitle(
  selection: InspectorSelection,
  t: ReturnType<typeof useTranslation>['t'],
  language: Language,
): string {
  if (selection.kind === 'model') {
    return t('inspector.modelTitle');
  }
  const piece = readablePieceName(selection.node.name, language);
  if (selection.kind === 'face') {
    const face = t(`inspector.faces.${selection.direction}`);
    return t('inspector.faceOf', { face: face.charAt(0).toUpperCase() + face.slice(1), piece });
  }
  if (selection.kind === 'edge') {
    return t(selection.edgeCount === 1 ? 'inspector.edgesOfOne' : 'inspector.edgesOf', {
      count: selection.edgeCount,
      piece,
    });
  }
  return piece;
}

/** The inspector's head: what is selected, in words, and its size in millimetres. */
function InspectorHeader({ isInSheet }: Readonly<{ isInSheet: boolean }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const { selection, piece } = useInspectorSelection();
  const size = selection.kind === 'model' ? undefined : pieceDimensions(selection.node);
  const title = selectionTitle(selection, t, language);
  return (
    <header className='border-b border-border px-4 pt-3 pb-3'>
      <div className='flex items-start gap-2'>
        <div className='min-w-0 flex-1'>
          <Eyebrow>{t(`inspector.kind.${selection.kind}`)}</Eyebrow>
          <h2 className='mt-0.5 truncate text-[15px] leading-6 font-medium' title={title}>
            {title}
          </h2>
          {selection.kind === 'model' ? (
            <p className='mt-0.5 text-xs leading-relaxed text-muted-foreground'>
              {t(selection.pieceCount === 1 ? 'inspector.piecesOne' : 'inspector.pieces', {
                count: selection.pieceCount,
              })}
              {' · '}
              {t('inspector.modelHint')}
            </p>
          ) : null}
        </div>
        {/* A tablet sheet carries its own close button. */}
        {isInSheet ? null : <InspectorLaneToggle place='lane' />}
      </div>
      {size && piece ? (
        <div className='mt-3'>
          <PieceSize size={size} pieceId={piece.node.id} language={language} />
        </div>
      ) : null}
    </header>
  );
}

/** The selected piece's own measures (the model's parameters for it), editable, under the tools. */
function InspectorPieceParameters(): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const { piece } = useInspectorSelection();
  const source = useProjectParametersSource();
  const entryPath = piece?.manifest.sourceFile;
  if (!piece || !entryPath) {
    return undefined;
  }
  return (
    <InspectorPieceMeasures
      source={source}
      entryPath={entryPath}
      pieceId={piece.node.id}
      frame={(measures) => (
        <section aria-label={t('inspector.pieceMeasures')} className='border-t border-border px-4 pt-3 pb-2'>
          <Eyebrow as='h3'>{t('inspector.pieceMeasures')}</Eyebrow>
          <div className='-mx-1 mt-1'>{measures}</div>
        </section>
      )}
    />
  );
}

/**
 * The project page's right lane, the one work mode (UI-UX-SinopiaCAD §3, Fable 26 ott §2.1): on top the contextual
 * inspector (what is selected, its measures, its tools), under it the assistant, always there as a composer strip
 * that opens into the whole conversation (⌃J). Nothing closes by itself.
 *
 * @param props - Whether the lane is on screen (only then does it host the viewer's tools), and whether it is a sheet.
 * @returns The lane.
 */
export function InspectorLane({
  isVisible,
  isInSheet = false,
}: {
  readonly isVisible: boolean;
  /** On a tablet the lane is a closable sheet over the model, whose own header closes it. */
  readonly isInSheet?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { setInspectorSlot, setInspectorHistorySlot, assistantExpanded, setAssistantExpanded } = useProjectWorkspace();
  const slot = useCallback(
    // oxlint-disable-next-line @typescript-eslint/no-restricted-types -- React callback refs receive null on detach.
    (node: HTMLDivElement | null) => {
      setInspectorSlot(isVisible && node ? node : undefined);
    },
    [isVisible, setInspectorSlot],
  );
  const historySlot = useCallback(
    // oxlint-disable-next-line @typescript-eslint/no-restricted-types -- React callback refs receive null on detach.
    (node: HTMLDivElement | null) => {
      setInspectorHistorySlot(isVisible && node ? node : undefined);
    },
    [isVisible, setInspectorHistorySlot],
  );
  useEffect(
    () => () => {
      setInspectorSlot(undefined);
      setInspectorHistorySlot(undefined);
    },
    [setInspectorSlot, setInspectorHistorySlot],
  );
  useKeybinding(
    toggleAssistantKeyCombination,
    () => {
      setAssistantExpanded(!assistantExpanded);
    },
    { enabled: isVisible },
  );
  return (
    <div data-slot='inspector-lane' className='flex size-full min-h-0 flex-col bg-sidebar'>
      <section
        aria-label={t('inspector.label')}
        className={cn('flex min-h-0 flex-col', assistantExpanded ? 'max-h-[40%] shrink-0' : 'flex-1')}
      >
        <div className='min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto overscroll-contain'>
          <InspectorHeader isInSheet={isInSheet} />
          <div className={cn(assistantExpanded && 'hidden')}>
            <div ref={slot} data-slot='inspector-tools' />
            <InspectorPieceParameters />
            <div ref={historySlot} data-slot='inspector-history' />
          </div>
        </div>
      </section>
      <AssistantDock
        isExpanded={assistantExpanded}
        onExpandedChange={setAssistantExpanded}
        keyHint={formatKeyCombination(toggleAssistantKeyCombination)}
      />
    </div>
  );
}
