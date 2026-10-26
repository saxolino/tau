import { useLayoutEffect, useRef } from 'react';
import { formatNumber, useTranslation } from '#i18n/translate.js';

/**
 * The quota beside the pointer while a handle is dragged (Shapr3D's «number at the gesture»): the signed distance of
 * a face, or the move of a piece, in mono. It follows the pointer inside the viewer; the inspector's field carries the
 * same value for keyboards and screen readers, so this copy stays out of the accessibility tree.
 *
 * @param props - Millimetres (signed), or a sentence already written.
 * @returns The quota.
 */
export function GestureQuota({ value }: { readonly value: number | string }): React.JSX.Element {
  const { language } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const owner = element?.offsetParent;
    if (!element || !(owner instanceof HTMLElement)) {
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
  }, []);
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
      aria-hidden
      data-slot='gesture-quota'
      className='pointer-events-none absolute top-0 left-0 z-30 rounded-md border border-titanium bg-background px-2 py-1 font-mono text-xs leading-4 tabular-nums opacity-0 shadow-md'
    >
      {text}
    </div>
  );
}
