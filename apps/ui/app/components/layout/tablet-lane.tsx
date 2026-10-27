import { useLayoutEffect, useRef } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';

/**
 * A workspace-local, nonmodal sheet: the top bar stays reachable to switch lanes.
 * Radix owns Escape and focus return; the viewer remains mounted behind the veil.
 */
export function TabletLane({
  label,
  side,
  onClose,
  children,
  isViewerInteractive = false,
}: {
  readonly label: string;
  readonly side: 'left' | 'right';
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  /**
   * The inspector works on what is clicked on the model, so its sheet leaves the viewer usable: no veil that closes it
   * on the first click. The sheet still closes from its own button and Escape.
   */
  readonly isViewerInteractive?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = globalThis.visualViewport;
    const panel = ref.current;
    if (!viewport || !panel) {
      return;
    }
    const fit = (): void => {
      const parentTop = panel.parentElement?.getBoundingClientRect().top ?? 0;
      const bottom = viewport.offsetTop + viewport.height;
      panel.style.maxHeight = `${Math.max(0, bottom - parentTop)}px`;
    };
    fit();
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    return () => {
      viewport.removeEventListener('resize', fit);
      viewport.removeEventListener('scroll', fit);
    };
  }, []);

  return (
    <Dialog.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {isViewerInteractive ? null : (
        <button
          type='button'
          tabIndex={-1}
          aria-label={t('common.close')}
          className='absolute inset-0 z-20 bg-foreground/10'
          onClick={onClose}
        />
      )}
      <Dialog.Content
        ref={ref}
        data-slot='tablet-lane'
        aria-describedby={undefined}
        className={cn(
          'absolute inset-y-0 z-30 flex w-96 max-w-full flex-col overflow-hidden border bg-background shadow-lg animate-in duration-200 motion-reduce:animate-none',
          side === 'left' ? 'left-0 slide-in-from-left' : 'right-0 slide-in-from-right',
        )}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <div className='flex min-h-12 shrink-0 items-center justify-between border-b px-2'>
          <Dialog.Title className='text-sm font-medium'>{label}</Dialog.Title>
          <Dialog.Close asChild>
            <Button variant='ghost' size='icon' aria-label={t('common.close')}>
              <X aria-hidden />
            </Button>
          </Dialog.Close>
        </div>
        <div className='min-h-0 flex-1 overflow-hidden'>{children}</div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
