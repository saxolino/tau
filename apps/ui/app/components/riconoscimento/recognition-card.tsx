import { useId, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Input } from '@taucad/ui/components/input';
import { cn } from '@taucad/ui/utils/cn';
import { statoValore } from '@taucad/smlib/riconoscimento';
import type {
  DomandaRiconoscimento,
  FamigliaCatalogo,
  ParametroCatalogo,
  SchedaRiconoscimento,
} from '@taucad/smlib/riconoscimento';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import type { Language } from '#i18n/language.js';
import { readablePieceName, visibleGroupName } from '#lib/piece-measures.js';

/**
 * The recognition card (SinopiaCAD D2 §2.7): «Riconosciuto: Fibbia · rettangolare», how it was seen (view, scale,
 * silhouette check), each recognised parameter with its state (measured, estimated ◐ with its confidence, assumed ○,
 * or the designer's value with the lock) and the plausible band the photo gave, then the one open question.
 */

/** A value of a parameter as the card shows it. */
type Valore = number | string | boolean;

/** What the card shows of the D3 silhouette check. */
export type VerificaCard =
  | Readonly<{ stato: 'non_disponibile' }>
  | Readonly<{ stato: 'fatta'; iou: number; suggerimenti?: readonly string[] }>;

const unitaVisibile: Record<string, string> = { mm: 'mm', deg: '°' };

/**
 * A parameter's label from its dotted key: «Cinturino · larghezza», «Telaio · altezza interna».
 *
 * @param chiave - The dotted key.
 * @param language - The interface language.
 * @returns The label.
 */
export function etichettaParametro(chiave: string, language: Language): string {
  const [gruppo, ...resto] = chiave.split('.');
  const campo = resto.join(' ');
  return campo
    ? `${readablePieceName(visibleGroupName(gruppo ?? ''), language)} · ${readablePieceName(campo, language).toLocaleLowerCase(language)}`
    : readablePieceName(visibleGroupName(gruppo ?? chiave), language);
}

const testoValore = (valore: Valore, unita: string | undefined, language: Language): string => {
  if (typeof valore === 'number') {
    const simbolo = unita === undefined ? '' : (unitaVisibile[unita] ?? '');
    return `${formatNumber(valore, language, { maximumFractionDigits: 2 })}${simbolo ? (simbolo === '°' ? '°' : ` ${simbolo}`) : ''}`;
  }
  return typeof valore === 'boolean'
    ? valore
      ? '✓'
      : '—'
    : readablePieceName(valore, language).toLocaleLowerCase(language);
};

/** The plausible band of a parameter on its recipe range, with a tick at the value. */
function BandaPlausibile({
  definizione,
  valore,
  min,
  max,
}: Readonly<{
  definizione: ParametroCatalogo | undefined;
  valore: number;
  min: number;
  max: number;
}>): React.JSX.Element {
  const basso = definizione?.min ?? Math.min(min, valore) - (max - min);
  const alto = definizione?.max ?? Math.max(max, valore) + (max - min);
  const ampiezza = alto - basso || 1;
  const posizione = (numero: number): number => Math.min(100, Math.max(0, ((numero - basso) / ampiezza) * 100));
  return (
    <span
      aria-hidden='true'
      data-slot='recognition-band'
      className='relative h-1.5 w-20 shrink-0 rounded-full bg-muted'
    >
      <span
        className='absolute inset-y-0 rounded-full bg-titanium'
        style={{ left: `${posizione(min)}%`, width: `${Math.max(2, posizione(max) - posizione(min))}%` }}
      />
      <span
        className='absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground'
        style={{ left: `${posizione(valore)}%` }}
      />
    </span>
  );
}

/** One recognised parameter: label and value, state marker, band. */
function RigaParametro({
  parametro,
  definizione,
  risposta,
  scalaStimata,
}: Readonly<{
  parametro: SchedaRiconoscimento['parametri'][number];
  definizione: ParametroCatalogo | undefined;
  risposta: Valore | undefined;
  scalaStimata: boolean;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  const valore = risposta ?? parametro.valore;
  const stato =
    risposta === undefined ? statoValore(parametro, { scalaStimata, unita: definizione?.unita ?? 'mm' }) : undefined;
  const confidenza = formatNumber(parametro.confidenza, language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const unita = definizione?.unita;
  const conBanda =
    risposta === undefined && typeof valore === 'number' && parametro.min !== undefined && parametro.max !== undefined;
  return (
    <li className='px-3 py-2' data-slot='recognition-parameter' data-state={stato ?? 'yours'}>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='min-w-0 truncate text-xs' title={definizione?.descrizione}>
          {etichettaParametro(parametro.chiave, language)}
        </span>
        <span className='shrink-0 font-mono text-xs text-foreground tabular-nums'>
          {testoValore(valore, unita, language)}
        </span>
      </div>
      <div className='mt-1 flex items-center justify-between gap-3'>
        <span
          className={cn(
            'flex min-w-0 items-center gap-1 truncate text-[11px] leading-4',
            stato === 'ipotesi' ? 'text-foreground' : 'text-muted-foreground',
          )}
          title={parametro.motivo}
        >
          {stato === undefined ? (
            <>
              <LockKeyhole aria-hidden='true' className='size-3 text-titanium-foreground' />
              {t('riconoscimento.states.yours')}
            </>
          ) : stato === 'misurata' ? (
            t('riconoscimento.states.measured')
          ) : stato === 'stimata' ? (
            t('riconoscimento.states.estimated', { confidence: confidenza })
          ) : (
            t('riconoscimento.states.assumed', { confidence: confidenza })
          )}
        </span>
        {conBanda ? (
          <span
            className='flex items-center'
            title={t('riconoscimento.bandLabel', {
              min: formatNumber(parametro.min!, language, { maximumFractionDigits: 2 }),
              max: formatNumber(parametro.max!, language, { maximumFractionDigits: 2 }),
              unit: unita === undefined ? '' : (unitaVisibile[unita] ?? ''),
            })}
          >
            <BandaPlausibile definizione={definizione} valore={valore} min={parametro.min!} max={parametro.max!} />
          </span>
        ) : null}
      </div>
    </li>
  );
}

/** A chip's answer: a parameter's value, a family, or a known measure. */
export type RispostaDomanda =
  | Readonly<{ tipo: 'parametro'; chiave: string; valore: number }>
  | Readonly<{ tipo: 'famiglia'; famiglia: string }>
  | Readonly<{ tipo: 'scala'; valoreMm: number; cosa: 'larghezza' | 'altezza' | 'diametro' }>;

const leggiNumero = (testo: string): number | undefined => {
  const numero = Number(testo.trim().replace(',', '.'));
  return Number.isFinite(numero) && numero > 0 ? numero : undefined;
};

/**
 * The one open question: three proposals and «Altro…» (a number), or the families, or a known measure.
 *
 * @param props - The question, its place in the queue, and what to do with the answer.
 * @returns The chip.
 */
export function ChipDomanda({
  domanda,
  posizione,
  isBusy = false,
  onRisposta,
}: Readonly<{
  domanda: DomandaRiconoscimento;
  posizione?: Readonly<{ corrente: number; totale: number }>;
  isBusy?: boolean;
  onRisposta: (risposta: RispostaDomanda) => void;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  const [isOther, setIsOther] = useState(false);
  const [testo, setTesto] = useState('');
  const [cosa, setCosa] = useState<'larghezza' | 'altezza' | 'diametro'>('larghezza');
  const titoloId = useId();
  const titolo =
    domanda.tipo === 'famiglia'
      ? t('riconoscimento.questionFamily')
      : domanda.tipo === 'scala'
        ? t('riconoscimento.questionScale')
        : etichettaParametro(domanda.chiave, language);
  const dettaglio =
    domanda.tipo === 'famiglia'
      ? t('riconoscimento.questionFamilyHint')
      : domanda.tipo === 'scala'
        ? t('riconoscimento.questionScaleHint')
        : domanda.motivo;
  const chip =
    'h-8 rounded-full border-border px-3 font-normal hover:border-titanium hover:bg-titanium/15 hover:text-foreground';
  const conferma = (): void => {
    const valore = leggiNumero(testo);
    if (valore === undefined || domanda.tipo === 'famiglia') {
      return;
    }
    onRisposta(
      domanda.tipo === 'scala'
        ? { tipo: 'scala', valoreMm: valore, cosa }
        : {
            tipo: 'parametro',
            chiave: domanda.chiave,
            valore: Math.min(domanda.max ?? Infinity, Math.max(domanda.min ?? -Infinity, valore)),
          },
    );
    setIsOther(false);
    setTesto('');
  };
  return (
    <div role='group' aria-labelledby={titoloId} data-slot='recognition-question' className='space-y-2 px-3 py-3'>
      {posizione ? (
        <Eyebrow>{t('riconoscimento.question', { current: posizione.corrente, total: posizione.totale })}</Eyebrow>
      ) : null}
      <div>
        <p id={titoloId} className='text-sm leading-5 font-medium'>
          {titolo}
        </p>
        {dettaglio ? <p className='mt-0.5 text-xs leading-relaxed text-muted-foreground'>{dettaglio}</p> : null}
      </div>
      {isOther || domanda.tipo === 'scala' ? (
        <form
          className='flex flex-wrap items-center gap-1.5'
          onSubmit={(event) => {
            event.preventDefault();
            conferma();
          }}
        >
          {domanda.tipo === 'scala' ? (
            <select
              aria-label={t('riconoscimento.measureWhat')}
              value={cosa}
              className='h-8 rounded-md border border-border bg-background px-2 text-xs'
              onChange={(event) => {
                setCosa(event.target.value as typeof cosa);
              }}
            >
              {(['larghezza', 'altezza', 'diametro'] as const).map((tipo) => (
                <option key={tipo} value={tipo}>
                  {t(`riconoscimento.measureKinds.${tipo}`)}
                </option>
              ))}
            </select>
          ) : null}
          <span className='flex items-center gap-1'>
            <Input
              autoFocus
              inputMode='decimal'
              aria-label={t('riconoscimento.otherValue')}
              value={testo}
              className='h-8 w-24 font-mono text-xs tabular-nums'
              onChange={(event) => {
                setTesto(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setIsOther(false);
                }
              }}
            />
            <span className='font-mono text-[11px] text-muted-foreground'>mm</span>
          </span>
          <Button type='submit' size='sm' disabled={isBusy || leggiNumero(testo) === undefined}>
            {t('riconoscimento.confirm')}
          </Button>
          {domanda.tipo === 'scala' ? null : (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() => {
                setIsOther(false);
              }}
            >
              {t('riconoscimento.cancel')}
            </Button>
          )}
        </form>
      ) : (
        <div className='flex flex-wrap gap-1.5'>
          {domanda.tipo === 'famiglia'
            ? domanda.opzioni.map((famiglia) => (
                <Button
                  key={famiglia}
                  type='button'
                  size='sm'
                  variant='outline'
                  className={chip}
                  disabled={isBusy}
                  onClick={() => {
                    onRisposta({ tipo: 'famiglia', famiglia });
                  }}
                >
                  {famiglia === 'libero'
                    ? t('riconoscimento.other')
                    : t(`riconoscimento.families.${famiglia}` as PlainMessageKey)}
                </Button>
              ))
            : domanda.proposte.map((proposta) => (
                <Button
                  key={proposta}
                  type='button'
                  size='sm'
                  variant='outline'
                  className={cn(chip, 'font-mono tabular-nums')}
                  disabled={isBusy}
                  onClick={() => {
                    onRisposta({ tipo: 'parametro', chiave: domanda.chiave, valore: proposta });
                  }}
                >
                  {testoValore(proposta, domanda.unita, language)}
                </Button>
              ))}
          {domanda.tipo === 'parametro' ? (
            <Button
              type='button'
              size='sm'
              variant='ghost'
              className='h-8 rounded-full px-3 font-normal text-muted-foreground'
              disabled={isBusy}
              onClick={() => {
                setIsOther(true);
              }}
            >
              {t('riconoscimento.other')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The family and variant label: «Fibbia · rettangolare».
 *
 * @param famiglia - Family id.
 * @param variante - Variant id.
 * @param t - The translator.
 * @returns The label.
 */
export const etichettaFamiglia = (
  famiglia: string,
  variante: string | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string => {
  const nome = t(`riconoscimento.families.${famiglia}` as PlainMessageKey);
  return variante
    ? t('riconoscimento.title', { family: nome, variant: t(`riconoscimento.variants.${variante}` as PlainMessageKey) })
    : nome;
};

/**
 * The recognition card.
 *
 * @param props - The recognition, the family catalogue entry, the designer's answers, the silhouette check, the open
 * question and what to do with its answer.
 * @returns The card.
 */
export function RecognitionCard({
  scheda,
  famiglia,
  variante,
  risposte = {},
  verifica,
  domanda,
  posizioneDomanda,
  isBusy,
  stato,
  onRisposta,
  className,
}: Readonly<{
  scheda: SchedaRiconoscimento;
  /** The catalogue entry of the family built (absent before building or for a free piece). */
  famiglia?: FamigliaCatalogo;
  /** The variant built (the recognised one unless the designer chose another family). */
  variante?: string;
  risposte?: Readonly<Record<string, Valore>>;
  verifica?: VerificaCard;
  domanda?: DomandaRiconoscimento;
  posizioneDomanda?: Readonly<{ corrente: number; totale: number }>;
  isBusy?: boolean;
  /** A line under the title while something happens («Costruisco il pezzo…»). */
  stato?: string;
  onRisposta?: (risposta: RispostaDomanda) => void;
  className?: string;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  const idFamiglia = famiglia?.id ?? scheda.famiglia.id;
  const definizioni = new Map((famiglia?.parametri ?? []).map((definizione) => [definizione.chiave, definizione]));
  const ordine = new Map((famiglia?.parametri ?? []).map((definizione, indice) => [definizione.chiave, indice]));
  const scalaStimata = scheda.scala.fonte === 'stima';
  const parametri = (famiglia === undefined || famiglia.id === scheda.famiglia.id ? scheda.parametri : [])
    .filter((parametro) => famiglia === undefined || definizioni.has(parametro.chiave))
    .toSorted((a, b) => (ordine.get(a.chiave) ?? 0) - (ordine.get(b.chiave) ?? 0));
  const aperte = parametri.filter(
    (parametro) =>
      risposte[parametro.chiave] === undefined &&
      statoValore(parametro, { scalaStimata, unita: definizioni.get(parametro.chiave)?.unita ?? 'mm' }) !== 'misurata',
  ).length;
  const meta = [
    t('riconoscimento.view', { view: t(`riconoscimento.views.${scheda.vista.nome}`) }),
    t('riconoscimento.scale', { source: t(`riconoscimento.scaleSources.${scheda.scala.fonte}`) }),
    verifica?.stato === 'fatta'
      ? t('riconoscimento.verification', {
          iou: formatNumber(verifica.iou, language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        })
      : t('riconoscimento.verificationUnavailable'),
  ].join(' · ');
  return (
    <section
      aria-label={t('riconoscimento.recognized')}
      data-slot='recognition-card'
      className={cn('overflow-hidden rounded-lg border border-border bg-background', className)}
    >
      <header className='px-3 pt-3 pb-2.5'>
        <div className='flex items-center justify-between gap-2'>
          <Eyebrow>{t('riconoscimento.recognized')}</Eyebrow>
          <span className='rounded-full border border-titanium px-2 font-mono text-[10px] leading-4 tracking-[0.12em] text-titanium-foreground uppercase'>
            {t('riconoscimento.fromPhoto')}
          </span>
        </div>
        <h3 className='mt-1 text-[15px] leading-6 font-medium'>
          {etichettaFamiglia(
            idFamiglia,
            variante ??
              (famiglia?.id === scheda.famiglia.id || famiglia === undefined
                ? scheda.variante.id
                : famiglia.varianti[0]),
            t,
          )}
        </h3>
        <p className='mt-0.5 text-xs leading-relaxed text-muted-foreground'>{meta}</p>
        <p className='mt-1 text-xs leading-4 text-muted-foreground' role='status'>
          {stato ??
            (aperte === 0
              ? t('riconoscimento.noAssumptions')
              : aperte === 1
                ? t('riconoscimento.oneAssumption')
                : t('riconoscimento.openAssumptions', { count: aperte }))}
        </p>
        {verifica?.stato === 'fatta' && verifica.suggerimenti?.includes('foto_lato') ? (
          <p className='mt-1 text-xs leading-4 text-muted-foreground' data-slot='recognition-suggestion'>
            {t('riconoscimento.suggestSidePhoto')}
          </p>
        ) : null}
      </header>
      {/* The one open question comes first: it is what the designer can act on now. */}
      {domanda && onRisposta ? (
        <div className='border-t border-border bg-sidebar'>
          <ChipDomanda
            key={domanda.tipo === 'parametro' ? domanda.chiave : domanda.tipo}
            domanda={domanda}
            posizione={posizioneDomanda}
            isBusy={isBusy}
            onRisposta={onRisposta}
          />
        </div>
      ) : null}
      {parametri.length > 0 ? (
        <ul className='divide-y divide-border border-t border-border'>
          {parametri.map((parametro) => (
            <RigaParametro
              key={parametro.chiave}
              parametro={parametro}
              definizione={definizioni.get(parametro.chiave)}
              risposta={risposte[parametro.chiave]}
              scalaStimata={scalaStimata}
            />
          ))}
        </ul>
      ) : null}
      {scheda.note ? (
        <p
          className='border-t border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground'
          title={t('riconoscimento.notes')}
        >
          {scheda.note}
        </p>
      ) : null}
    </section>
  );
}
