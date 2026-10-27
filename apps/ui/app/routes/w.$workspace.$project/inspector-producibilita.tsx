import { useState } from 'react';
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@taucad/ui/components/select';
import { cn } from '@taucad/ui/utils/cn';
import { soglieProcessi } from '@taucad/smlib/famiglie';
import type { Processo } from '@taucad/smlib/famiglie';
import { riepilogoProducibilita } from '@taucad/smlib/producibilita';
import type { ControlloProducibilita } from '@taucad/smlib/producibilita';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { useInspectorSelection } from '#hooks/use-inspector-selection.js';
import { producibilitaMessages } from '#i18n/messages/producibilita.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey, Translate } from '#i18n/translate.js';
import type { Language } from '#i18n/language.js';
import { direzioniSformo, processiProducibilita } from '#lib/producibilita.js';
import type { DirezioneSformo, PezzoProducibilita } from '#lib/producibilita.js';
import { readablePieceName } from '#lib/piece-measures.js';
import { useProducibilita } from '#routes/w.$workspace.$project/producibilita-context.js';
import type { Producibilita } from '#routes/w.$workspace.$project/producibilita-context.js';

/**
 * The inspector's «Producibilità» (E1): for the selected piece, or for every piece of the model, the process it is
 * checked for and the checks with their state and their measured value against the minimum. A check that points at the
 * model shows there when clicked (the faces under the minimum, the draft map); the thresholds name their sources.
 */

const codiciNoti = new Set(Object.keys(producibilitaMessages.it.codes));

/**
 * A check's name, as a maker says it: the known codes from the messages, the others from their own words.
 *
 * @param t - The translator.
 * @param codice - The check's code.
 * @returns The name.
 */
export function nomeControllo(t: Translate, codice: string): string {
  if (codiciNoti.has(codice)) {
    return t(`producibilita.codes.${codice}` as PlainMessageKey);
  }
  const parole = codice.toLowerCase().replaceAll('_', ' ');
  return parole.charAt(0).toUpperCase() + parole.slice(1);
}

const numero = (value: number, language: Language, digits = 2): string =>
  formatNumber(value, language, { maximumFractionDigits: digits });

/**
 * A check's value against its minimum, in the unit it measures: «0,42 mm · min 0,5», «0° · min 1° · 6 facce».
 *
 * @param controllo - The check.
 * @param t - The translator.
 * @param language - For the numbers.
 * @returns The text, or undefined when the check carries no number to show.
 */
export function valoreControllo(
  controllo: ControlloProducibilita,
  t: Translate,
  language: Language,
): string | undefined {
  const { valore, soglia, unita, conteggio } = controllo;
  const facce = (count: number): string =>
    count === 1 ? t('producibilita.values.facesOne') : t('producibilita.values.faces', { count });
  if (controllo.codice === 'SOLIDO_CHIUSO') {
    return controllo.livello === 'ok' ? t('producibilita.values.closed') : t('producibilita.values.open');
  }
  if (unita === 'n') {
    return conteggio ? facce(conteggio) : t('producibilita.values.none');
  }
  if (valore === undefined || !Number.isFinite(valore)) {
    return undefined;
  }
  if (unita === 'deg') {
    const testo =
      soglia === undefined
        ? `${numero(valore, language, 1)}°`
        : t('producibilita.values.deg', { value: numero(valore, language, 1), minimum: numero(soglia, language, 1) });
    return controllo.livello !== 'ok' && conteggio ? `${testo} · ${facce(conteggio)}` : testo;
  }
  if (unita === 'mm') {
    return soglia === undefined
      ? t('producibilita.values.mmNoMinimum', { value: numero(valore, language) })
      : t('producibilita.values.mm', { value: numero(valore, language), minimum: numero(soglia, language) });
  }
  return undefined;
}

function IconaLivello({ livello }: Readonly<{ livello: ControlloProducibilita['livello'] }>): React.JSX.Element {
  const classe = 'mt-0.5 size-3.5 shrink-0';
  if (livello === 'blocco') {
    return <OctagonX aria-hidden className={cn(classe, 'text-destructive')} />;
  }
  if (livello === 'avviso') {
    return <TriangleAlert aria-hidden className={cn(classe, 'text-warning')} />;
  }
  if (livello === 'ok') {
    return <CircleCheck aria-hidden className={cn(classe, 'text-success')} />;
  }
  return <Info aria-hidden className={cn(classe, 'text-muted-foreground')} />;
}

/** One check: its state, its name and its value; clicked, it shows on the model (when it points at faces). */
function RigaControllo({
  controllo,
  isFocused,
  onFocus,
}: Readonly<{ controllo: ControlloProducibilita; isFocused: boolean; onFocus?: () => void }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const nome = nomeControllo(t, controllo.codice);
  const valore = valoreControllo(controllo, t, language);
  const livello = t(`producibilita.levels.${controllo.livello}`);
  // A check the geometry does not measure says what it is in its own words.
  const dettaglio = isFocused || !controllo.fonti.includes('geometria') ? controllo.messaggio : undefined;
  const contenuto = (
    <>
      <IconaLivello livello={controllo.livello} />
      <span className='min-w-0 flex-1'>
        <span className='flex items-baseline justify-between gap-2'>
          <span className='truncate text-xs leading-5'>
            {nome}
            <span className='sr-only'>: {livello}</span>
          </span>
          {valore ? (
            <span className='shrink-0 font-mono text-[11px] leading-5 text-muted-foreground tabular-nums'>
              {valore}
            </span>
          ) : null}
        </span>
        {dettaglio ? (
          <span className='block text-[11px] leading-4 text-pretty text-muted-foreground'>{dettaglio}</span>
        ) : null}
      </span>
    </>
  );
  return (
    <li data-slot='producibility-check' data-level={controllo.livello}>
      {onFocus ? (
        <button
          type='button'
          aria-pressed={isFocused}
          title={isFocused ? t('producibilita.shown') : t('producibilita.show')}
          className={cn(
            'flex w-full items-start gap-2 px-2 py-1 text-left outline-none',
            'hover:bg-accent focus-visible:bg-accent pointer-coarse:min-h-11',
            'aria-pressed:bg-titanium/15 aria-pressed:shadow-[inset_2px_0_0_var(--titanium)]',
          )}
          onClick={onFocus}
        >
          {contenuto}
        </button>
      ) : (
        <div className='flex items-start gap-2 px-2 py-1'>{contenuto}</div>
      )}
    </li>
  );
}

const pesoLivello: Readonly<Record<ControlloProducibilita['livello'], number>> = {
  blocco: 0,
  avviso: 1,
  ok: 2,
  info: 3,
};

/** One piece's process and checks; checks passed fold into one line when the group is not the selection's. */
function GruppoPezzo({
  pezzo,
  controlli,
  producibilita,
  isExpanded,
}: Readonly<{
  pezzo: PezzoProducibilita | undefined;
  controlli: readonly ControlloProducibilita[];
  producibilita: Producibilita;
  isExpanded: boolean;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  const [isOpen, setIsOpen] = useState(isExpanded);
  const ordinati = controlli.toSorted((a, b) => pesoLivello[a.livello] - pesoLivello[b.livello]);
  // Checks passed and notes fold into one line until the group is opened: what needs work comes first.
  const piegati = ordinati.filter(({ livello }) => livello === 'ok' || livello === 'info');
  const passati = piegati.filter(({ livello }) => livello === 'ok');
  const visibili = isOpen ? ordinati : ordinati.filter((controllo) => !piegati.includes(controllo));
  const nome = pezzo ? readablePieceName(pezzo.nome, language) : t('producibilita.model');
  return (
    <div className='space-y-1.5' data-slot='producibility-piece'>
      <div className='flex min-w-0 items-center gap-2'>
        <span className='min-w-0 flex-1 truncate text-xs font-medium' title={nome}>
          {nome}
        </span>
        {pezzo && !pezzo.pietra ? (
          <Select
            size='sm'
            value={pezzo.processo}
            onValueChange={(value) => {
              producibilita.setProcesso(pezzo.nome, value as Processo);
            }}
          >
            <SelectTrigger className='w-44 shrink-0 text-xs' aria-label={t('producibilita.processOf', { piece: nome })}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position='popper'>
              {processiProducibilita.map((processo) => (
                <SelectItem key={processo} value={processo}>
                  {t(`producibilita.processes.${processo}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {pezzo?.pietra ? (
        <p className='text-xs text-muted-foreground'>{t('producibilita.stone')}</p>
      ) : (
        <ul className='divide-y divide-border overflow-hidden rounded-md border border-border bg-background'>
          {visibili.map((controllo) => (
            <RigaControllo
              key={controllo.id}
              controllo={controllo}
              isFocused={producibilita.focus === controllo.id}
              {...(controllo.evidenza && controllo.pezzo
                ? {
                    onFocus: () => {
                      producibilita.setFocus(producibilita.focus === controllo.id ? undefined : controllo.id);
                    },
                  }
                : {})}
            />
          ))}
          {!isOpen && piegati.length > 0 ? (
            <li>
              <button
                type='button'
                className='flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent pointer-coarse:min-h-11'
                onClick={() => {
                  setIsOpen(true);
                }}
              >
                {passati.length > 0 ? (
                  <CircleCheck aria-hidden className='size-3.5 shrink-0 text-success' />
                ) : (
                  <Info aria-hidden className='size-3.5 shrink-0' />
                )}
                {(passati.length > 0 ? passati : piegati).map(({ codice }) => nomeControllo(t, codice)).join(' · ')}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/** The state of the checks in a few words, by the section's title. */
function Riepilogo({ producibilita }: Readonly<{ producibilita: Producibilita }>): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const { blocchi, avvisi } = riepilogoProducibilita(producibilita.controlli);
  if (producibilita.stato === 'in_corso' && !producibilita.aggiornati) {
    return (
      <span role='status' aria-busy className='flex items-center gap-1 text-[11px] text-muted-foreground'>
        <LoaderCircle aria-hidden className='size-3 animate-spin' />
        {t('producibilita.checking')}
      </span>
    );
  }
  if (producibilita.controlli.length === 0) {
    return undefined;
  }
  if (blocchi === 0 && avvisi === 0) {
    return (
      <span role='status' className='flex items-center gap-1 text-[11px] text-success'>
        <CircleCheck aria-hidden className='size-3' />
        {t('producibilita.allClear')}
      </span>
    );
  }
  const parti = [
    blocchi > 0
      ? {
          classe: 'text-destructive',
          testo:
            blocchi === 1
              ? t('producibilita.summary.blocksOne')
              : t('producibilita.summary.blocks', { count: blocchi }),
        }
      : undefined,
    avvisi > 0
      ? {
          classe: 'text-warning',
          testo:
            avvisi === 1
              ? t('producibilita.summary.warningsOne')
              : t('producibilita.summary.warnings', { count: avvisi }),
        }
      : undefined,
  ].filter((parte) => parte !== undefined);
  return (
    <span role='status' className='flex items-center gap-1.5 text-[11px] font-medium'>
      {parti.map((parte, indice) => (
        <span key={parte.testo} className={parte.classe}>
          {indice > 0 ? '· ' : ''}
          {parte.testo}
        </span>
      ))}
    </span>
  );
}

/**
 * The section for a fixed value: the selected piece's group, or every piece's, with the direction and the sources.
 *
 * @param props - The checks and the selected piece's name (undefined for the whole model).
 * @returns The section.
 */
export function ProducibilitaSectionView({
  producibilita,
  pezzoSelezionato,
}: Readonly<{ producibilita: Producibilita; pezzoSelezionato: string | undefined }>): React.JSX.Element {
  const { t } = useTranslation();
  const selezionato =
    pezzoSelezionato === undefined ? undefined : producibilita.pezzi.find(({ nome }) => nome === pezzoSelezionato);
  const pezzi = selezionato ? [selezionato] : producibilita.pezzi;
  const delModello = producibilita.controlli.filter(
    ({ pezzo }) => pezzo === undefined || !producibilita.pezzi.some(({ nome }) => nome === pezzo),
  );
  const processi = [...new Set(pezzi.filter(({ pietra }) => !pietra).map(({ processo }) => processo))];
  const conStampo = processi.filter(
    (processo) =>
      soglieProcessi[processo].sformoMinimo !== undefined || soglieProcessi[processo].sottosquadro !== 'libero',
  );
  return (
    <section
      aria-label={t('producibilita.title')}
      className='border-t border-border px-4 pt-3 pb-3'
      data-slot='inspector-producibility'
    >
      <div className='flex items-baseline justify-between gap-2'>
        <Eyebrow as='h3'>{t('producibilita.title')}</Eyebrow>
        <Riepilogo producibilita={producibilita} />
      </div>
      {producibilita.stato === 'non_disponibile' ? (
        <p className='mt-1.5 text-xs text-muted-foreground'>{t('producibilita.unavailable')}</p>
      ) : null}
      {producibilita.stato === 'errore' ? (
        <p className='mt-1.5 flex items-center gap-2 text-xs text-muted-foreground'>
          {t('producibilita.failed')}
          <button
            type='button'
            className='text-foreground underline underline-offset-2'
            onClick={producibilita.riprova}
          >
            {t('producibilita.retry')}
          </button>
        </p>
      ) : null}
      {producibilita.controlli.length > 0 ? (
        <div className={cn('mt-2 space-y-3', !producibilita.aggiornati && 'opacity-70')}>
          {pezzi.map((pezzo) => (
            <GruppoPezzo
              // A group opened for the selection starts open; the model's list starts folded.
              key={`${pezzo.nome}:${selezionato ? 'pezzo' : 'modello'}`}
              pezzo={pezzo}
              controlli={producibilita.controlli.filter((controllo) => controllo.pezzo === pezzo.nome)}
              producibilita={producibilita}
              isExpanded={selezionato !== undefined}
            />
          ))}
          {delModello.length > 0 ? (
            <GruppoPezzo
              pezzo={undefined}
              controlli={delModello}
              producibilita={producibilita}
              isExpanded={selezionato !== undefined}
            />
          ) : null}
          {conStampo.length > 0 ? (
            <label className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
              {conStampo.every((processo) => processo === 'cnc')
                ? t('producibilita.directionCnc')
                : t('producibilita.direction')}
              <Select
                size='sm'
                value={producibilita.direzione}
                onValueChange={(value) => {
                  producibilita.setDirezione(value as DirezioneSformo);
                }}
              >
                <SelectTrigger className='w-28 text-xs' aria-label={t('producibilita.direction')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position='popper'>
                  {(Object.keys(direzioniSformo) as DirezioneSformo[]).map((direzione) => (
                    <SelectItem key={direzione} value={direzione}>
                      {t(`producibilita.directions.${direzione}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : null}
          <details className='group text-[11px] leading-4 text-muted-foreground'>
            <summary className='select-none hover:text-foreground'>{t('producibilita.sources')}</summary>
            <div className='mt-1.5 space-y-2'>
              {processi.map((processo) => (
                <div key={processo} className='space-y-0.5'>
                  <p className='font-medium text-foreground'>{t(`producibilita.processes.${processo}`)}</p>
                  <p className='text-pretty'>{soglieProcessi[processo].note}</p>
                  <ul className='list-disc space-y-0.5 pl-4'>
                    {soglieProcessi[processo].riferimenti.map((riferimento) => (
                      <li key={riferimento} className='text-pretty'>
                        {riferimento}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p>{t('producibilita.sourcesNote')}</p>
            </div>
          </details>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The section in the inspector, for the selection: nothing outside a project page or before the first render.
 *
 * @returns The section, or undefined.
 */
export function InspectorProducibilita(): React.JSX.Element | undefined {
  const producibilita = useProducibilita();
  const { selection } = useInspectorSelection();
  if (!producibilita || (producibilita.stato === 'inattivo' && producibilita.controlli.length === 0)) {
    return undefined;
  }
  return (
    <ProducibilitaSectionView
      producibilita={producibilita}
      pezzoSelezionato={selection.kind === 'model' ? undefined : selection.node.name}
    />
  );
}
