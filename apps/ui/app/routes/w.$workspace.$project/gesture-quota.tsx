import { useLayoutEffect, useRef } from 'react';
import { formatNumber, useTranslation } from '#i18n/translate.js';

/** A quota being typed at the gesture (the sketch's D): a labelled field in the same place as the quota. */
type GestureQuotaEditing = Readonly<{
  /** What the field asks for: «Lunghezza (mm)», «Raggio (mm)». */
  label: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}>;

/**
 * The quota beside the pointer while a handle is dragged (Shapr3D's «number at the gesture»): the signed distance of
 * a face, or the move of a piece, in mono. It follows the pointer inside the viewer; the inspector's field carries the
 * same value for keyboards and screen readers, so this copy stays out of the accessibility tree. While a quota is typed
 * (the sketch's D) it stops where the pointer was and holds a labelled field: Invio applies it, Esc drops it.
 *
 * @param props - Millimetres (signed), or a sentence already written; the field when the quota is typed.
 * @returns The quota.
 */
export function GestureQuota({
  value,
  editing,
}: {
  readonly value: number | string;
  readonly editing?: GestureQuotaEditing;
}): React.JSX.Element {
  const { language } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const isEditing = editing !== undefined;
  useLayoutEffect(() => {
    const element = ref.current;
    const owner = element?.offsetParent;
    if (!element || !(owner instanceof HTMLElement) || isEditing) {
      return;
    }
    const move = (event: PointerEvent): void => {
      const rect = owner.getBoundingClientRect();
      element.style.transform = `translate(${Math.round(event.clientX - rect.left + 18)}px, ${Math.round(event.clientY - rect.top + 18)}px)`;
      element.style.opacity = '1';
    };
    element.ownerDocument.addEventListener('pointermove', move, { passive: true });
    return () => {
      element.ownerDocument.removeEventListener('pointermove', move);
    };
  }, [isEditing]);
  const text =
    typeof value === 'number'
      ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatNumber(Math.abs(value), language, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} mm`
      : value;
  return (
    <div
      ref={ref}
      aria-hidden={isEditing ? undefined : true}
      data-slot='gesture-quota'
      className={
        isEditing
          ? 'absolute top-0 left-0 z-30 flex items-center gap-1 rounded-md border border-titanium bg-background px-1.5 py-1 font-mono text-xs leading-4 tabular-nums shadow-md'
          : 'pointer-events-none absolute top-0 left-0 z-30 rounded-md border border-titanium bg-background px-2 py-1 font-mono text-xs leading-4 tabular-nums opacity-0 shadow-md'
      }
    >
      {editing ? (
        <input
          // The field opens on D, with the keyboard already in it.
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- D asks for the quota: the keyboard belongs in its field.
          autoFocus
          aria-label={editing.label}
          inputMode='decimal'
          defaultValue=''
          placeholder={text}
          className='w-28 bg-transparent text-foreground outline-none placeholder:text-muted-foreground'
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              editing.onSubmit(event.currentTarget.value);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              editing.onCancel();
            }
            event.stopPropagation();
          }}
          onBlur={editing.onCancel}
        />
      ) : (
        text
      )}
    </div>
  );
}
