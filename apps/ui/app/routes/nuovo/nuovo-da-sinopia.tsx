import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@taucad/ui/components/button';
import { catalogoFamiglie } from '@taucad/smlib/riconoscimento';
import { PageHeader } from '#components/layout/page-header.js';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { Spinner } from '#components/ui/spinner.js';
import { RecognitionCard } from '#components/riconoscimento/recognition-card.js';
import { useTranslation } from '#i18n/translate.js';
import { useRiconoscimentoNuovo } from '#routes/nuovo/use-riconoscimento-nuovo.js';
import type { ParteVista } from '#routes/nuovo/use-riconoscimento-nuovo.js';
import { leggiParametriNuovo } from '#services/sinopia-parts.js';

/** The part's picture with its mask as a titanium watermark, and what Sinopia says about it. */
function FotoParte({ parte }: Readonly<{ parte: ParteVista }>): React.JSX.Element {
  const { t } = useTranslation();
  const { schedaParte } = parte;
  const altre = schedaParte.altreParti.map((altra) => altra.etichetta).slice(0, 6);
  return (
    <figure className='min-w-0 space-y-2'>
      <div className='relative overflow-hidden rounded-lg border border-border bg-muted'>
        <img
          src={parte.immagineUrl}
          alt={schedaParte.parte.etichetta}
          className='block h-auto w-full'
          width={schedaParte.immagine.larghezzaPx}
          height={schedaParte.immagine.altezzaPx}
        />
        {/* The mask as a watermark: the picture veiled everywhere but on the part, so what will be measured stands
            out without being painted over. */}
        <div
          aria-hidden='true'
          data-slot='part-mask'
          className='pointer-events-none absolute inset-0 bg-background/70'
          style={{
            maskImage: `linear-gradient(black, black), url(${parte.mascheraUrl})`,
            maskMode: 'alpha, luminance',
            maskSize: '100% 100%',
            maskComposite: 'exclude',
          }}
        />
        <span className='absolute top-2 left-2 rounded-md border border-border bg-background/90 px-2 py-0.5 font-mono text-[10px] leading-4 tracking-[0.12em] text-muted-foreground uppercase'>
          {schedaParte.maschera?.origine === 'contorno'
            ? t('riconoscimento.maskFromOutline')
            : t('riconoscimento.maskWatermark')}
        </span>
      </div>
      <figcaption className='space-y-0.5'>
        <p className='text-sm leading-5'>
          <span className='text-muted-foreground'>{t('riconoscimento.part')}: </span>
          {schedaParte.parte.etichetta}
        </p>
        {altre.length > 0 ? (
          <p className='text-xs text-muted-foreground'>{t('riconoscimento.otherParts', { parts: altre.join(', ') })}</p>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** A step in progress: spinner and words. */
function Passo({ testo }: Readonly<{ testo: string }>): React.JSX.Element {
  return (
    <p className='flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-3 text-sm'>
      <Spinner className='text-titanium-foreground' />
      {testo}
    </p>
  );
}

/**
 * «/cad/nuovo» (SinopiaCAD D2): the part isolated in Sinopia beside what the recognition reads in it; the piece is
 * built as soon as the family is sure and opens in the viewer, the uncertain values become questions there.
 *
 * @returns The page.
 */
export function NuovoDaSinopia(): React.JSX.Element {
  const { t, language } = useTranslation();
  const [parametri] = useSearchParams();
  const query = parametri.toString();
  const lettura = useMemo(
    () => leggiParametriNuovo(new URLSearchParams(query), { prove: import.meta.env.DEV }),
    [query],
  );
  const { fase, scegliFamiglia, riprova } = useRiconoscimentoNuovo(lettura, language === 'en' ? 'en' : 'it');
  const catalogo = useMemo(() => catalogoFamiglie(), []);
  const parte = 'parte' in fase ? fase.parte : undefined;
  const esito = 'esito' in fase ? fase.esito : undefined;
  const famiglia = esito
    ? catalogo.find(
        (voce) => voce.id === (fase.fase === 'costruisco' && fase.famiglia ? fase.famiglia : esito.scheda.famiglia.id),
      )
    : undefined;
  return (
    <div
      className='mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-6 lg:px-8'
      data-slot='nuovo-da-sinopia'
    >
      <div className='space-y-1'>
        <Eyebrow>{t('riconoscimento.eyebrow')}</Eyebrow>
        <PageHeader title={t('riconoscimento.pageTitle')} />
        {parte?.prova ? <p className='text-xs text-muted-foreground'>{t('riconoscimento.trial')}</p> : null}
      </div>
      <div className='grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_22rem]'>
        {parte ? (
          <FotoParte parte={parte} />
        ) : (
          <div className='aspect-square w-full rounded-lg border border-border bg-muted' />
        )}
        <div className='space-y-3' aria-live='polite'>
          {fase.fase === 'leggo' ? <Passo testo={t('riconoscimento.reading')} /> : null}
          {fase.fase === 'riconosco' ? <Passo testo={t('riconoscimento.recognizing')} /> : null}
          {esito && (fase.fase === 'costruisco' || fase.fase === 'scegli_famiglia' || fase.fase === 'fermo') ? (
            <RecognitionCard
              scheda={esito.scheda}
              famiglia={famiglia}
              {...(fase.fase === 'scegli_famiglia'
                ? {
                    domanda: fase.domanda,
                    onRisposta: (risposta) => {
                      if (risposta.tipo === 'famiglia') {
                        scegliFamiglia(risposta.famiglia);
                      }
                    },
                  }
                : {})}
              {...(fase.fase === 'costruisco' ? { stato: t('riconoscimento.building'), isBusy: true } : {})}
            />
          ) : null}
          {fase.fase === 'costruisco' ? <Passo testo={t('riconoscimento.building')} /> : null}
          {fase.fase === 'fermo' || fase.fase === 'errore' ? (
            <div
              role={fase.fase === 'errore' ? 'alert' : 'status'}
              className='space-y-3 rounded-lg border border-border bg-background px-3 py-3'
            >
              <p className='text-sm leading-5'>{t(fase.messaggio)}</p>
              <div className='flex flex-wrap gap-2'>
                {fase.fase === 'errore' && fase.riprova ? (
                  <Button size='sm' onClick={riprova}>
                    {t('riconoscimento.retry')}
                  </Button>
                ) : null}
                <Button size='sm' variant='outline' asChild>
                  <Link to='/'>{t('riconoscimento.backHome')}</Link>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
