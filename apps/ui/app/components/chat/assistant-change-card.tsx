import { useState } from 'react';
import { LockKeyhole, Undo2, X } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { useTranslation } from '#i18n/translate.js';

/** One changed value: the piece it belongs to (a link to it), the parameter, before → after. */
export type RigaCambiamento = Readonly<{
  id: string;
  pezzo?: string;
  etichetta: string;
  prima: string;
  dopo: string;
  /** The value is the designer's own (the lock of the Measures). */
  tuo?: boolean;
  /** The piece can be selected on the model. */
  selezionabile?: boolean;
}>;

/** Whether «Annulla» can run: ready, running, or not anymore (with the reason). */
export type StatoAnnulla =
  | Readonly<{ stato: 'pronto'; onAnnulla: () => void }>
  | Readonly<{ stato: 'in_corso' }>
  | Readonly<{ stato: 'non_disponibile'; motivo: string }>;

/**
 * «Cosa ho cambiato» (SinopiaCAD D4): after a change the assistant made, what changed in a designer's words, three
 * rows at most before «+ N altre», and one «Annulla» that takes the whole change back as one history entry. No wall of
 * text, no filled button: undoing is the secondary action of a change already made.
 *
 * @param props - Title, the change's name, rows, the undo, how to close and how to select a row's piece.
 * @returns The card.
 */
export function AssistantChangeCard({
  titolo,
  sottotitolo,
  righe,
  vuoto,
  annulla,
  maxRighe = 3,
  onChiudi,
  onSelezionaPezzo,
  className,
}: Readonly<{
  titolo: string;
  sottotitolo?: string;
  righe: readonly RigaCambiamento[];
  /** Said when nothing can be listed (a code change, values unknown). */
  vuoto?: string;
  annulla?: StatoAnnulla;
  maxRighe?: number;
  onChiudi?: () => void;
  onSelezionaPezzo?: (riga: RigaCambiamento) => void;
  className?: string;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [isAperta, setIsAperta] = useState(false);
  const visibili = isAperta ? righe : righe.slice(0, maxRighe);
  const nascoste = righe.length - visibili.length;
  return (
    <section
      aria-label={sottotitolo ? `${titolo} · ${sottotitolo}` : titolo}
      data-slot='assistant-change'
      className={cn('rounded-lg border border-border bg-background text-xs', className)}
    >
      <header className='flex min-h-8 items-center gap-2 pt-1.5 pr-1.5 pl-3'>
        <Eyebrow as='h3' className='min-w-0 flex-1 truncate'>
          {titolo}
        </Eyebrow>
        {onChiudi ? (
          <PaneButton
            aria-label={t('assistant.change.dismiss')}
            tooltip={t('assistant.change.dismiss')}
            onClick={onChiudi}
          >
            <X aria-hidden className='size-3.5' />
          </PaneButton>
        ) : null}
      </header>
      {sottotitolo ? <p className='px-3 text-[13px] leading-5 font-medium'>{sottotitolo}</p> : null}
      {righe.length === 0 ? (
        <p className='px-3 pt-1 pb-2.5 text-muted-foreground'>{vuoto}</p>
      ) : (
        <ul className='space-y-1 px-3 pt-1.5 pb-2'>
          {visibili.map((riga) => (
            <li key={riga.id} className='flex items-baseline justify-between gap-3'>
              <span className='min-w-0 leading-snug'>
                {riga.pezzo ? (
                  riga.selezionabile && onSelezionaPezzo ? (
                    <button
                      type='button'
                      className='cursor-action text-foreground underline decoration-titanium underline-offset-2 hover:decoration-foreground focus-visible:focus-outline'
                      onClick={() => {
                        onSelezionaPezzo(riga);
                      }}
                    >
                      {riga.pezzo}
                    </button>
                  ) : (
                    <span>{riga.pezzo}</span>
                  )
                ) : null}
                {riga.pezzo && riga.etichetta ? <span className='text-muted-foreground'> · </span> : null}
                <span className={riga.pezzo ? 'text-muted-foreground' : undefined}>{riga.etichetta}</span>
                {riga.tuo ? (
                  <span className='ml-1.5 inline-flex items-center gap-1 text-muted-foreground'>
                    <LockKeyhole aria-hidden className='size-3 text-titanium-foreground' />
                    {t('agent.yours')}
                  </span>
                ) : null}
              </span>
              <span className='shrink-0 font-mono whitespace-nowrap tabular-nums'>{`${riga.prima} → ${riga.dopo}`}</span>
            </li>
          ))}
        </ul>
      )}
      {nascoste > 0 ? (
        <button
          type='button'
          className='mx-3 mb-2 text-muted-foreground hover:text-foreground focus-visible:focus-outline'
          onClick={() => {
            setIsAperta(true);
          }}
        >
          {nascoste === 1 ? t('assistant.change.moreOne') : t('assistant.change.more', { count: nascoste })}
        </button>
      ) : null}
      {annulla ? (
        <div className='flex min-h-10 items-center gap-2 border-t border-border px-3 py-1.5'>
          {annulla.stato === 'non_disponibile' ? (
            <p className='text-muted-foreground'>{annulla.motivo}</p>
          ) : (
            <Button
              variant='outline'
              size='xs'
              disabled={annulla.stato === 'in_corso'}
              aria-busy={annulla.stato === 'in_corso' ? true : undefined}
              onClick={annulla.stato === 'pronto' ? annulla.onAnnulla : undefined}
            >
              <Undo2 aria-hidden className='size-3.5' />
              {annulla.stato === 'in_corso' ? t('assistant.change.undoing') : t('assistant.change.undo')}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
