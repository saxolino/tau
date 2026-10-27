import { LoaderCircle, OctagonX } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@taucad/ui/components/dialog';
import type { ControlloProducibilita } from '@taucad/smlib/producibilita';
import { useTranslation } from '#i18n/translate.js';
import { readablePieceName } from '#lib/piece-measures.js';
import { nomeControllo, valoreControllo } from '#routes/w.$workspace.$project/inspector-producibilita.js';

/**
 * The soft block in front of Esporta (E1): while checks block production, Esporta first lists them with «Correggi»
 * (back to the model, the first block shown on it) and «Esporta comunque» (the export goes on; the choice is written
 * to the project's register). While the checks run, it says so and lets the export go on without waiting.
 *
 * @param props - Whether the checks are still running, the blocks, and the two choices.
 * @returns The dialog.
 */
export function ProducibilityExportGate({
  isChecking,
  blocchi,
  onFix,
  onExportAnyway,
  onOpenChange,
}: Readonly<{
  isChecking: boolean;
  blocchi: readonly ControlloProducibilita[];
  onFix: () => void;
  onExportAnyway: () => void;
  onOpenChange: (open: boolean) => void;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-120' data-slot='producibility-export-gate'>
        <DialogHeader>
          <DialogTitle>{t('producibilita.gate.title')}</DialogTitle>
          <DialogDescription>
            {isChecking ? t('producibilita.gate.checking') : t('producibilita.gate.description')}
          </DialogDescription>
        </DialogHeader>
        {isChecking ? (
          <p role='status' aria-busy className='flex items-center gap-2 text-sm text-muted-foreground'>
            <LoaderCircle aria-hidden className='size-4 animate-spin' />
            {t('producibilita.checking')}
          </p>
        ) : (
          <div className='space-y-2'>
            <p className='text-sm font-medium text-destructive'>
              {blocchi.length === 1
                ? t('producibilita.gate.blocksOne')
                : t('producibilita.gate.blocks', { count: blocchi.length })}
            </p>
            <ul
              className='divide-y divide-border rounded-md border border-border'
              aria-label={t('producibilita.title')}
            >
              {blocchi.map((blocco) => {
                const valore = valoreControllo(blocco, t, language);
                return (
                  <li key={blocco.id} className='flex items-start gap-2 px-3 py-2'>
                    <OctagonX aria-hidden className='mt-0.5 size-4 shrink-0 text-destructive' />
                    <span className='min-w-0 flex-1'>
                      <span className='flex flex-wrap items-baseline justify-between gap-x-3'>
                        <span className='text-sm'>
                          {blocco.pezzo
                            ? t('producibilita.gate.item', {
                                piece: readablePieceName(blocco.pezzo, language),
                                check: nomeControllo(t, blocco.codice),
                              })
                            : nomeControllo(t, blocco.codice)}
                        </span>
                        {valore ? (
                          <span className='font-mono text-xs text-muted-foreground tabular-nums'>{valore}</span>
                        ) : null}
                      </span>
                      <span className='block text-xs text-pretty text-muted-foreground'>{blocco.messaggio}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <DialogFooter className='gap-2 sm:justify-end'>
          {isChecking ? (
            <Button variant='outline' size='sm' className='pointer-coarse:min-h-11' onClick={onExportAnyway}>
              {t('producibilita.gate.exportWithoutWaiting')}
            </Button>
          ) : (
            <>
              <Button variant='outline' size='sm' className='pointer-coarse:min-h-11' onClick={onExportAnyway}>
                {t('producibilita.gate.exportAnyway')}
              </Button>
              <Button size='sm' className='pointer-coarse:min-h-11' onClick={onFix}>
                {t('producibilita.gate.fix')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
