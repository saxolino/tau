import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '@taucad/ui/components/button';
import { catalogoFamiglie } from '@taucad/smlib/riconoscimento';
import { PageHeader } from '#components/layout/page-header.js';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { Spinner } from '#components/ui/spinner.js';
import { RecognitionCard } from '#components/riconoscimento/recognition-card.js';
import { useTranslation } from '#i18n/translate.js';
import { useRiconoscimentoNuovo } from '#routes/nuovo/use-riconoscimento-nuovo.js';
import type { CostoCostruzione, ParteVista, VistaMostrata } from '#routes/nuovo/use-riconoscimento-nuovo.js';
import { leggiParametriNuovo } from '#services/sinopia-parts.js';

/** The part's picture with its mask as a titanium watermark, and what Sinopia says about it. */
function FotoParte({
  parte,
  viste,
}: Readonly<{ parte: ParteVista; viste?: readonly VistaMostrata[] }>): React.JSX.Element {
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
          {parte.scontornoDaSfondo
            ? t('riconoscimento.maskFromBackground')
            : schedaParte.maschera?.origine === 'contorno'
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
      {viste && viste.length > 0 ? <VisteGenerate viste={viste} /> : null}
    </figure>
  );
}

/** Le viste generate dalla foto, sotto la foto: la principale e il controllo, con il loro ruolo. */
function VisteGenerate({ viste }: Readonly<{ viste: readonly VistaMostrata[] }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className='grid grid-cols-2 gap-3' data-slot='viste-generate'>
      {viste.map((vista) => {
        const didascalia =
          vista.ruolo === 'principale'
            ? t('riconoscimento.generatedViews.mainCaption')
            : t('riconoscimento.generatedViews.controlCaption');
        return (
          <figure key={vista.ruolo} className='min-w-0 space-y-1'>
            <div className='overflow-hidden rounded-lg border border-border bg-muted'>
              <img src={vista.url} alt={didascalia} className='block aspect-square h-auto w-full object-contain' />
            </div>
            <figcaption className='text-xs text-muted-foreground'>{didascalia}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

/** Che cosa costa costruire il pezzo, e il pulsante che lo fa partire: niente parte prima del clic. */
function ConfermaCosto({
  costo,
  onCostruisci,
}: Readonly<{ costo: CostoCostruzione; onCostruisci: () => void }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className='space-y-3 rounded-lg border border-border bg-background px-3 py-3' data-slot='conferma-costo'>
      <p className='text-sm leading-5 font-medium'>{t('riconoscimento.start.title')}</p>
      <p className='text-sm leading-5 text-muted-foreground'>
        {costo.viste === 0
          ? t('riconoscimento.start.bodyRecognition')
          : costo.riusata
            ? t('riconoscimento.start.bodyReused')
            : t('riconoscimento.start.bodyViews')}
      </p>
      {costo.viste > 0 ? (
        <p className='font-mono text-[10px] leading-4 tracking-[0.12em] text-muted-foreground uppercase'>
          {t('riconoscimento.start.breakdown', {
            recognition: String(costo.riconoscimento),
            views: String(costo.viste),
            view: String(costo.prezzoVista),
          })}
        </p>
      ) : null}
      <div className='flex flex-wrap gap-2'>
        <Button size='sm' onClick={onCostruisci}>
          {costo.totale === 1
            ? t('riconoscimento.start.buttonOne')
            : t('riconoscimento.start.button', { credits: String(costo.totale) })}
        </Button>
        <Button size='sm' variant='outline' asChild>
          <Link to='/'>{t('riconoscimento.backHome')}</Link>
        </Button>
      </div>
    </div>
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
  const {
    fase,
    costruisci,
    scegliFamiglia,
    riprova,
    continuaSenzaViste,
    rigeneraViste,
    confermaLeMisure,
    saltaVerifica,
    apriEsistente,
    rifaiDaCapo,
  } = useRiconoscimentoNuovo(lettura, language === 'en' ? 'en' : 'it');
  const staVerificando = fase.fase === 'verifico';
  // Esc stops the check (and with it the worker): the piece is then built from the recognition alone.
  useEffect(() => {
    if (!staVerificando) {
      return;
    }
    const alTasto = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') {
        evento.preventDefault();
        saltaVerifica();
      }
    };
    document.addEventListener('keydown', alTasto);
    return () => {
      document.removeEventListener('keydown', alTasto);
    };
  }, [saltaVerifica, staVerificando]);
  const catalogo = useMemo(() => catalogoFamiglie(), []);
  const parte = 'parte' in fase ? fase.parte : undefined;
  const esito = 'esito' in fase ? fase.esito : undefined;
  const viste = 'viste' in fase ? fase.viste : undefined;
  const famiglia = esito
    ? catalogo.find(
        (voce) =>
          voce.id ===
          ((fase.fase === 'costruisco' || fase.fase === 'verifico' || fase.fase === 'non_combacia') && fase.famiglia
            ? fase.famiglia
            : esito.scheda.famiglia.id),
      )
    : undefined;
  const formatoIou = (iou: number): string =>
    iou.toLocaleString(language === 'en' ? 'en-US' : 'it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
          <FotoParte parte={parte} {...(viste ? { viste } : {})} />
        ) : (
          <div className='aspect-square w-full rounded-lg border border-border bg-muted' />
        )}
        <div className='space-y-3' aria-live='polite'>
          {fase.fase === 'leggo' ? <Passo testo={t('riconoscimento.reading')} /> : null}
          {fase.fase === 'conferma' ? <ConfermaCosto costo={fase.costo} onCostruisci={costruisci} /> : null}
          {fase.fase === 'viste' ? (
            <Passo
              testo={
                fase.passo === 'principale'
                  ? t('riconoscimento.generatedViews.main')
                  : fase.passo === 'controllo'
                    ? t('riconoscimento.generatedViews.control')
                    : t('riconoscimento.generatedViews.preparing')
              }
            />
          ) : null}
          {fase.fase === 'riconosco' ? <Passo testo={t('riconoscimento.recognizing')} /> : null}
          {fase.fase === 'esiste' ? (
            <div role='status' className='space-y-3 rounded-lg border border-border bg-background px-3 py-3'>
              <p className='text-sm leading-5 font-medium'>{t('riconoscimento.existing.title')}</p>
              <p className='text-sm leading-5 text-muted-foreground'>
                {t('riconoscimento.existing.body', { name: fase.modello.name })}
              </p>
              <div className='flex flex-wrap gap-2'>
                <Button size='sm' onClick={apriEsistente}>
                  {t('riconoscimento.existing.open')}
                </Button>
                <Button size='sm' variant='outline' onClick={rifaiDaCapo}>
                  {t('riconoscimento.existing.redo')}
                </Button>
              </div>
            </div>
          ) : null}
          {fase.fase === 'non_combacia' ? (
            <div
              role='status'
              className='space-y-3 rounded-lg border border-border bg-background px-3 py-3'
              data-slot='non-combacia'
            >
              <p className='text-sm leading-5 font-medium'>{t('riconoscimento.mismatch.title')}</p>
              <p className='text-sm leading-5 text-muted-foreground'>
                {fase.motivo === 'viste_incoerenti'
                  ? t('riconoscimento.mismatch.bodyViews', { iou: formatoIou(fase.iou) })
                  : t('riconoscimento.mismatch.bodyPhoto', { iou: formatoIou(fase.iou) })}
              </p>
              <div className='flex flex-wrap gap-2'>
                <Button size='sm' onClick={rigeneraViste}>
                  {t('riconoscimento.mismatch.regenerate', { credits: String(fase.costoRigenera) })}
                </Button>
                <Button size='sm' variant='outline' onClick={confermaLeMisure}>
                  {t('riconoscimento.mismatch.confirm')}
                </Button>
              </div>
              <p className='text-xs leading-relaxed text-muted-foreground'>
                {t('riconoscimento.mismatch.confirmHint')}
              </p>
            </div>
          ) : null}
          {esito &&
          (fase.fase === 'verifico' ||
            fase.fase === 'costruisco' ||
            fase.fase === 'scegli_famiglia' ||
            fase.fase === 'non_combacia' ||
            fase.fase === 'fermo') ? (
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
              {...(fase.fase === 'verifico' ? { stato: t('riconoscimento.verifying'), isBusy: true } : {})}
              {...(fase.fase === 'costruisco'
                ? {
                    stato: t('riconoscimento.building'),
                    isBusy: true,
                    ...(fase.iou === undefined ? {} : { verifica: { stato: 'fatta' as const, iou: fase.iou } }),
                  }
                : {})}
            />
          ) : null}
          {fase.fase === 'verifico' ? (
            <div className='space-y-2 rounded-lg border border-border bg-background px-3 py-3'>
              <p className='flex items-center gap-2 text-sm'>
                <Spinner className='text-titanium-foreground' />
                {t('riconoscimento.verifying')}
              </p>
              <p className='text-xs leading-relaxed text-muted-foreground'>{t('riconoscimento.verifyingHint')}</p>
              <Button size='sm' variant='outline' onClick={saltaVerifica}>
                {t('riconoscimento.skipCheck')}
                <span className='ml-2 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase'>
                  {t('riconoscimento.skipCheckKey')}
                </span>
              </Button>
            </div>
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
                {fase.fase === 'errore' && fase.senzaViste ? (
                  <Button size='sm' variant='outline' onClick={continuaSenzaViste}>
                    {fase.conPrincipale
                      ? t('riconoscimento.generatedViews.continueWithMain')
                      : t('riconoscimento.generatedViews.continueWithout')}
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
