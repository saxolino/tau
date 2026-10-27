import { Check, CircleHelp, Columns3, Gem, PenLine, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { useTranslation } from '#i18n/translate.js';
import type { ChipAssistente, SchedaModello } from '#lib/assistant-brief.js';

/** One outcome of the checks to look at: its sentence, how bad, and the piece it is about. */
export type RigaControllo = Readonly<{ id: string; testo: string; livello: 'avviso' | 'blocco'; pezzo?: string }>;

/** The checks of the model: running, unavailable, or done with what to look at (none for a free model). */
export type ControlliScheda =
  | Readonly<{ stato: 'caricamento' }>
  | Readonly<{ stato: 'errore' }>
  | Readonly<{ stato: 'pronto'; righe: readonly RigaControllo[] }>;

const iconaChip = (chip: ChipAssistente): LucideIcon => {
  switch (chip.tipo) {
    case 'modifica': {
      return chip.origine === 'correzione' ? Wrench : Gem;
    }
    case 'varianti': {
      return Columns3;
    }
    case 'ipotesi': {
      return CircleHelp;
    }
    case 'scrivi': {
      return PenLine;
    }
  }
};

/** Outcomes shown before «+ N»: the card stays a card. */
const righeMassime = 2;

/**
 * The assistant's first word about an open model (SinopiaCAD D4): a card, not a greeting. On top what the model is
 * (family and variant, key measures in mono, material and weight, size; the silhouette match and the open
 * assumptions); then what to check from the manufacturability checks; then three next steps, the first one the only
 * filled button. A step that changes the model says so in its words («Porta la parete a 1,2 mm»); a step that only
 * writes to the assistant carries the pen.
 *
 * @param props - The card's words, the checks, the next steps, which one is running and what a click does.
 * @returns The card.
 */
export function AssistantBriefCard({
  scheda,
  controlli,
  chips,
  chipInCorso,
  onChip,
  onSelezionaPezzo,
  className,
}: Readonly<{
  scheda: SchedaModello;
  controlli?: ControlliScheda;
  chips: readonly ChipAssistente[];
  /** The step being applied: its chip is busy and the others wait. */
  chipInCorso?: string;
  onChip: (chip: ChipAssistente) => void;
  onSelezionaPezzo?: (pezzo: string) => void;
  className?: string;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const fatti = [...scheda.dettagli, ...scheda.stato];
  const righe = controlli?.stato === 'pronto' ? controlli.righe : [];
  return (
    <section
      aria-label={t('assistant.brief.label')}
      data-slot='assistant-brief'
      className={cn('rounded-lg border border-border bg-background', className)}
    >
      <header className='px-3 pt-2.5 pb-2'>
        <div className='flex items-center justify-between gap-2'>
          <Eyebrow>{t('assistant.brief.label')}</Eyebrow>
          {scheda.daFoto ? (
            <span className='rounded-full border border-titanium px-2 font-mono text-[10px] leading-4 tracking-[0.12em] text-titanium-foreground uppercase'>
              {t('assistant.brief.fromPhoto')}
            </span>
          ) : null}
        </div>
        <h3 className='mt-0.5 truncate text-[15px] leading-6 font-medium' title={scheda.titolo}>
          {scheda.titolo}
        </h3>
        {scheda.misure.length > 0 ? (
          <dl className='mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-5'>
            {scheda.misure.map((misura) => (
              <div key={misura.etichetta} className='flex items-baseline gap-1'>
                <dt className='text-muted-foreground'>{misura.etichetta}</dt>
                <dd className='font-mono tabular-nums'>{misura.valore}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {fatti.length > 0 ? (
          <p className='mt-0.5 text-xs leading-5 text-muted-foreground tabular-nums'>{fatti.join(' · ')}</p>
        ) : null}
      </header>
      {controlli ? (
        <div className='border-t border-border px-3 py-2 text-xs'>
          {controlli.stato === 'caricamento' ? (
            <p role='status' className='flex items-center gap-1.5 text-muted-foreground'>
              <span aria-hidden className='size-1.5 animate-pulse rounded-full bg-titanium' />
              {t('assistant.brief.checking')}
            </p>
          ) : controlli.stato === 'errore' ? (
            <p className='text-muted-foreground'>{t('assistant.brief.checkFailed')}</p>
          ) : righe.length === 0 ? (
            <p className='flex items-center gap-1.5 text-muted-foreground'>
              <Check aria-hidden className='size-3.5 text-success' />
              {t('assistant.brief.noIssues')}
            </p>
          ) : (
            <>
              <Eyebrow as='p'>{t('assistant.brief.toCheck')}</Eyebrow>
              <ul className='mt-1 space-y-0.5'>
                {righe.slice(0, righeMassime).map((riga) => {
                  const segno = (
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-1.5 shrink-0 rounded-full',
                        riga.livello === 'blocco' ? 'bg-destructive' : 'bg-warning',
                      )}
                    />
                  );
                  return (
                    <li key={riga.id} className='flex items-start gap-1.5 leading-5'>
                      {segno}
                      {riga.pezzo && onSelezionaPezzo ? (
                        <button
                          type='button'
                          className='min-w-0 text-left hover:text-foreground hover:underline hover:decoration-titanium focus-visible:focus-outline'
                          title={t('assistant.brief.selectPiece', { piece: riga.pezzo })}
                          onClick={() => {
                            onSelezionaPezzo(riga.pezzo!);
                          }}
                        >
                          {riga.testo}
                        </button>
                      ) : (
                        <span className='min-w-0'>{riga.testo}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {righe.length > righeMassime ? (
                <p className='mt-0.5 pl-3 text-muted-foreground'>
                  {righe.length - righeMassime === 1
                    ? t('assistant.change.moreOne')
                    : t('assistant.change.more', { count: righe.length - righeMassime })}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div
          role='group'
          aria-label={t('assistant.brief.nextSteps')}
          className='flex flex-wrap gap-1.5 border-t border-border px-3 py-2.5'
        >
          {chips.map((chip, indice) => {
            const Icona = iconaChip(chip);
            const isPrimo = indice === 0;
            const isInCorso = chipInCorso === chip.id;
            return (
              <Button
                key={chip.id}
                variant={isPrimo ? 'default' : 'outline'}
                size='xs'
                disabled={chipInCorso !== undefined}
                aria-busy={isInCorso ? true : undefined}
                data-chip={chip.tipo}
                className='h-auto min-h-7 max-w-full justify-start rounded-lg py-1 text-left leading-snug font-normal whitespace-normal'
                onClick={() => {
                  onChip(chip);
                }}
              >
                <Icona
                  aria-hidden
                  className={cn(
                    'size-3.5 shrink-0',
                    !isPrimo && 'text-titanium-foreground',
                    isInCorso && 'animate-pulse',
                  )}
                />
                {chip.testo}
              </Button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
