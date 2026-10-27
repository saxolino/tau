import { useEffect, useId, useRef, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { cn } from '@taucad/ui/utils/cn';
import { PaneButton } from '@taucad/workbench-panes/components/pane-button';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { useTranslation } from '#i18n/translate.js';
import type { RigaModifica } from '#lib/assistant-brief.js';

/** One variant as the card shows it: name, the agent's reason, preview, two or three differences, weight. */
export type VarianteCard = Readonly<{
  id: string;
  nome: string;
  motivo?: string;
  /** An image URL of the preview (object URL of the worker's PNG). */
  anteprima?: string;
  righe: readonly RigaModifica[];
  peso?: Readonly<{ prima: string; dopo: string; variazione: string }>;
  /** Said when the variant fails a manufacturability check the current model passes. */
  avviso?: string;
}>;

/** What the card holds: variants being prepared, a failure, nothing to propose, or the variants. */
export type ContenutoVarianti =
  | Readonly<{ stato: 'caricamento'; messaggio?: string }>
  | Readonly<{ stato: 'errore'; messaggio: string; onRiprova?: () => void }>
  | Readonly<{ stato: 'vuoto'; messaggio: string }>
  | Readonly<{ stato: 'pronto'; varianti: readonly VarianteCard[] }>;

/** Differences shown per variant: the card stays a card. */
const righeMassime = 3;

/**
 * Variants side by side (SinopiaCAD D5): a preview of each, in a row the arrows walk; the chosen one's differences in
 * words and numbers under the row; «Usa questa» (the one filled button) applies it as one history entry, «Scarta»
 * drops it. Esc closes the card.
 *
 * @param props - Title, where the variants come from, what the card holds, which one is being applied, and the
 *   actions.
 * @returns The card.
 */
export function AssistantVariantsCard({
  titolo,
  daAgente = false,
  contenuto,
  inApplicazione,
  autoFocus = false,
  onUsa,
  onScarta,
  onChiudi,
  className,
}: Readonly<{
  titolo: string;
  daAgente?: boolean;
  contenuto: ContenutoVarianti;
  /** The variant being applied: every action waits. */
  inApplicazione?: string;
  /** Move the focus to the chosen variant as soon as the variants are ready (a click asked for them). */
  autoFocus?: boolean;
  onUsa: (id: string) => void;
  onScarta: (id: string) => void;
  onChiudi?: () => void;
  className?: string;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [scelta, setScelta] = useState(0);
  const tessere = useRef<Array<HTMLButtonElement | undefined>>([]);
  const idDettaglio = useId();
  const varianti = contenuto.stato === 'pronto' ? contenuto.varianti : [];
  const indice = Math.min(scelta, Math.max(0, varianti.length - 1));
  const variante = varianti[indice];
  const isPronto = contenuto.stato === 'pronto';
  useEffect(() => {
    if (isPronto && autoFocus) {
      tessere.current[0]?.focus();
    }
  }, [autoFocus, isPronto]);
  const scegli = (prossimo: number): void => {
    const limitato = (prossimo + varianti.length) % varianti.length;
    setScelta(limitato);
    tessere.current[limitato]?.focus();
  };
  const isOccupato = inApplicazione !== undefined;
  return (
    <section
      aria-label={titolo}
      data-slot='assistant-variants'
      className={cn('rounded-lg border border-border bg-background text-xs', className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && onChiudi) {
          event.preventDefault();
          event.stopPropagation();
          onChiudi();
        }
      }}
    >
      <header className='flex min-h-8 items-center gap-2 pt-1.5 pr-1.5 pl-3'>
        <Eyebrow as='h3' className='min-w-0 flex-1 truncate'>
          {titolo}
        </Eyebrow>
        {daAgente ? (
          <span className='shrink-0 rounded-full border border-titanium px-2 font-mono text-[10px] leading-4 tracking-[0.12em] text-titanium-foreground uppercase'>
            {t('assistant.variants.fromAgent')}
          </span>
        ) : null}
        {onChiudi ? (
          <PaneButton
            aria-label={t('assistant.variants.close')}
            tooltip={t('assistant.variants.close')}
            onClick={onChiudi}
          >
            <X aria-hidden className='size-3.5' />
          </PaneButton>
        ) : null}
      </header>
      {contenuto.stato === 'caricamento' ? (
        <div className='px-3 pt-1.5 pb-3'>
          <div aria-hidden className='grid grid-cols-3 gap-2'>
            {[0, 1, 2].map((tessera) => (
              <div key={tessera} className='aspect-[4/3] animate-pulse rounded-md bg-muted' />
            ))}
          </div>
          <p role='status' className='mt-2 flex items-center gap-1.5 text-muted-foreground'>
            <span aria-hidden className='size-1.5 animate-pulse rounded-full bg-titanium' />
            {contenuto.messaggio ?? t('assistant.variants.loading')}
          </p>
          {contenuto.messaggio === undefined ? (
            <p className='mt-0.5 text-muted-foreground'>{t('assistant.variants.loadingHint')}</p>
          ) : null}
        </div>
      ) : contenuto.stato === 'errore' ? (
        <div role='alert' className='flex flex-wrap items-center gap-2 px-3 pt-1 pb-3'>
          <p className='text-muted-foreground'>{contenuto.messaggio}</p>
          {contenuto.onRiprova ? (
            <Button variant='outline' size='xs' onClick={contenuto.onRiprova}>
              {t('assistant.variants.retry')}
            </Button>
          ) : null}
        </div>
      ) : contenuto.stato === 'vuoto' ? (
        <p className='px-3 pt-1 pb-3 text-muted-foreground'>{contenuto.messaggio}</p>
      ) : (
        <>
          <div
            role='radiogroup'
            aria-label={t('assistant.variants.label')}
            className={cn('grid gap-2 px-3 pt-1.5', varianti.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}
            onKeyDown={(event) => {
              const passo =
                event.key === 'ArrowRight' || event.key === 'ArrowDown'
                  ? 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (passo !== 0) {
                event.preventDefault();
                scegli(indice + passo);
              } else if (event.key === 'Enter' && variante && !isOccupato) {
                event.preventDefault();
                onUsa(variante.id);
              }
            }}
          >
            {varianti.map((voce, posizione) => (
              <button
                key={voce.id}
                ref={(nodo) => {
                  tessere.current[posizione] = nodo ?? undefined;
                }}
                type='button'
                role='radio'
                aria-checked={posizione === indice}
                aria-controls={idDettaglio}
                tabIndex={posizione === indice ? 0 : -1}
                className={cn(
                  'flex min-w-0 flex-col rounded-md border border-border bg-muted/40 p-1 text-left transition-colors',
                  'hover:bg-accent focus-visible:focus-outline',
                  'aria-checked:border-titanium aria-checked:bg-background aria-checked:ring-1 aria-checked:ring-titanium',
                )}
                onClick={() => {
                  setScelta(posizione);
                }}
              >
                {voce.anteprima ? (
                  <img
                    src={voce.anteprima}
                    alt={t('assistant.variants.preview', { name: voce.nome })}
                    className='aspect-[4/3] w-full object-contain'
                    draggable={false}
                  />
                ) : (
                  <span className='flex aspect-[4/3] w-full items-center justify-center px-1 text-center text-[10px] text-muted-foreground'>
                    {t('assistant.variants.noPreview')}
                  </span>
                )}
                <span className='mt-1 truncate px-0.5 text-[11px] leading-4 font-medium'>{voce.nome}</span>
                {voce.peso ? (
                  <span className='px-0.5 font-mono text-[10px] leading-4 text-muted-foreground tabular-nums'>
                    {voce.peso.variazione}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          {variante ? (
            <div id={idDettaglio} aria-live='polite' className='mt-2 border-t border-border px-3 pt-2 pb-2.5'>
              <div className='flex items-baseline justify-between gap-2'>
                <h4 className='truncate text-[13px] leading-5 font-medium'>{variante.nome}</h4>
                <span className='shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums'>
                  {t('assistant.variants.position', { current: indice + 1, total: varianti.length })}
                </span>
              </div>
              {variante.motivo ? <p className='text-muted-foreground'>{variante.motivo}</p> : null}
              <dl className='mt-1.5 space-y-0.5'>
                {variante.righe.slice(0, righeMassime).map((riga) => (
                  <div key={riga.id} className='flex flex-wrap items-baseline justify-between gap-x-3'>
                    <dt className='min-w-0 text-muted-foreground'>{riga.etichetta}</dt>
                    <dd className='ml-auto font-mono whitespace-nowrap tabular-nums'>{`${riga.prima} → ${riga.dopo}`}</dd>
                  </div>
                ))}
                {variante.peso ? (
                  <div className='flex items-baseline justify-between gap-3'>
                    <dt className='text-muted-foreground'>{t('assistant.variants.weight')}</dt>
                    <dd className='shrink-0 font-mono whitespace-nowrap tabular-nums'>{`${variante.peso.prima} → ${variante.peso.dopo}`}</dd>
                  </div>
                ) : null}
              </dl>
              {variante.avviso ? (
                <p className='mt-1.5 flex items-start gap-1.5 text-warning'>
                  <TriangleAlert aria-hidden className='mt-px size-3.5 shrink-0' />
                  {variante.avviso}
                </p>
              ) : null}
              <div className='mt-2.5 flex items-center gap-2'>
                <Button
                  size='sm'
                  disabled={isOccupato}
                  aria-busy={inApplicazione === variante.id ? true : undefined}
                  onClick={() => {
                    onUsa(variante.id);
                  }}
                >
                  {inApplicazione === variante.id ? t('assistant.variants.applying') : t('assistant.variants.use')}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={isOccupato}
                  onClick={() => {
                    onScarta(variante.id);
                  }}
                >
                  {t('assistant.variants.discard')}
                </Button>
              </div>
            </div>
          ) : null}
          <p className='px-3 pb-2 font-mono text-[10px] leading-4 text-muted-foreground pointer-coarse:hidden'>
            {t('assistant.variants.keyboard')}
          </p>
        </>
      )}
    </section>
  );
}
