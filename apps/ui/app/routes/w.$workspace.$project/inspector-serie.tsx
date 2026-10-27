import { useCallback, useMemo, useRef, useState } from 'react';
import { Download, LoaderCircle, TriangleAlert } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@taucad/ui/components/select';
import { cn } from '@taucad/ui/utils/cn';
import { rigaTaglia, tabellaTaglie, tagliaDaDiametro, diametroInterno } from '@taucad/smlib/famiglie';
import type { IdFamiglia, SistemaTaglia } from '@taucad/smlib/famiglie';
import {
  asseDellaSerie,
  csvSerie,
  famiglieConSerie,
  intervalloConsigliato,
  regoleDiCrescita,
  taglieMassimeSerie,
} from '@taucad/smlib/serie';
import type { RiepilogoSerie, RigaSerie } from '@taucad/smlib/serie';
import { toast } from '#components/ui/sonner.js';
import { useAssistantModel } from '#hooks/use-assistant-model.js';
import { useProject } from '#hooks/use-project.js';
import type { Language } from '#i18n/language.js';
import { formatNumber, useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey, Translate } from '#i18n/translate.js';
import { etichettaParametro } from '#lib/assistant-brief.js';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { prendiValutatoreVarianti } from '#services/varianti-worker.js';

/**
 * «Taglia e serie» in the inspector (E3b): for a ring, the size picked in the system of choice (IT, ISO, US, diameter)
 * with the same size read in the others; for a ring, a sole or a heel, the series of models over a range of sizes
 * with its summary table (key measures and weight), the rules by which the measures grow, and the table as CSV.
 * The files of the whole series come from `esportaSerieStep` of `@taucad/smlib/serie`, which Esporta calls.
 */

const sistemi: readonly SistemaTaglia[] = ['it', 'eu_iso', 'us', 'diametro'];

/** The key measures of each family's table; the CSV carries all of them. */
const colonneTabella: Readonly<Partial<Record<IdFamiglia, readonly string[]>>> = {
  anello: ['diametro', 'gamboSpessore'],
  fondo_semplice: ['lunghezza', 'larghezzaPianta'],
  tacco: ['altezza', 'tappoAltezza'],
};

const numero = (valore: number, language: Language, cifre = 2): string =>
  formatNumber(valore, language, { maximumFractionDigits: cifre });

/** The value a size select holds: sizes have halves, so the number goes through a string. */
const comeTesto = (valore: number): string => String(Math.round(valore * 100) / 100);

/** What the section needs of the model, apart from where it is written. */
export type SerieModello = Readonly<{
  famiglia: IdFamiglia;
  variante: string;
  parametri: unknown;
}>;

type StatoSerie =
  | Readonly<{ stato: 'inattivo' }>
  | Readonly<{ stato: 'in_corso'; conteggio: number }>
  | Readonly<{ stato: 'errore' }>
  | Readonly<{ stato: 'pronto'; riepilogo: RiepilogoSerie }>;

/** The size of a ring in every system: the picked one, then the equivalents. */
function TagliaAnello({
  parametri,
  onCambia,
}: Readonly<{
  parametri: { taglia: { sistema: SistemaTaglia; valore: number } };
  onCambia: (taglia: { sistema: SistemaTaglia; valore: number }) => void;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  const { sistema, valore } = parametri.taglia;
  const righe = useMemo(() => tabellaTaglie(sistema), [sistema]);
  const riga = rigaTaglia(sistema, valore);
  return (
    <div className='space-y-2'>
      <div className='grid grid-cols-[1fr_1fr] gap-2'>
        <label className='space-y-1 text-xs text-muted-foreground'>
          {t('serie.system')}
          <Select
            size='sm'
            value={sistema}
            onValueChange={(nuovo) => {
              // The same finger in the new system: the nearest size there.
              const prossimo = nuovo as SistemaTaglia;
              onCambia({ sistema: prossimo, valore: tagliaDaDiametro(prossimo, diametroInterno(sistema, valore)) });
            }}
          >
            <SelectTrigger className='w-full text-xs' aria-label={t('serie.system')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position='popper'>
              {sistemi.map((voce) => (
                <SelectItem key={voce} value={voce}>
                  {t(`serie.systems.${voce}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className='space-y-1 text-xs text-muted-foreground'>
          {t('serie.size')}
          <Select
            size='sm'
            value={comeTesto(valore)}
            onValueChange={(nuovo) => {
              onCambia({ sistema, valore: Number(nuovo) });
            }}
          >
            <SelectTrigger className='w-full font-mono text-xs tabular-nums' aria-label={t('serie.size')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent position='popper' className='max-h-64'>
              {righe.map((voce) => (
                <SelectItem key={voce.valore} value={comeTesto(voce.valore)} className='font-mono text-xs tabular-nums'>
                  {t('serie.sizeOption', {
                    size: `${t(`serie.systemsShort.${sistema}`)} ${numero(voce.valore, language, 1)}`,
                    diameter: numero(voce.diametro, language, 1),
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      <p className='font-mono text-[11px] leading-4 text-muted-foreground tabular-nums'>
        {t('serie.equivalent', {
          it: numero(riga.it, language, 0),
          eu: numero(riga.eu_iso, language, 0),
          us: numero(riga.us, language, 1),
        })}
      </p>
      <p className='font-mono text-[11px] leading-4 text-muted-foreground tabular-nums'>
        {t('serie.readIn', {
          diameter: numero(riga.diametro, language),
          circumference: numero(riga.circonferenza, language, 1),
        })}
      </p>
    </div>
  );
}

/** The EU size of a sole. */
function TagliaFondo({
  taglia,
  onCambia,
}: Readonly<{ taglia: number; onCambia: (taglia: number) => void }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const valori = Array.from({ length: 25 }, (_, k) => 35 + k * 0.5);
  return (
    <div className='space-y-2'>
      <label className='block space-y-1 text-xs text-muted-foreground'>
        {t('serie.size')}
        <Select
          size='sm'
          value={comeTesto(taglia)}
          onValueChange={(nuovo) => {
            onCambia(Number(nuovo));
          }}
        >
          <SelectTrigger className='w-full font-mono text-xs tabular-nums' aria-label={t('serie.size')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position='popper' className='max-h-64'>
            {valori.map((valore) => (
              <SelectItem key={valore} value={comeTesto(valore)} className='font-mono text-xs tabular-nums'>
                {t('serie.systemsShort.eu_iso')} {numero(valore, language, 1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

/** The table: one row per size, key measures in mono, weight at the end; the current size is marked. */
export function TabellaSerie({
  riepilogo,
  corrente,
}: Readonly<{ riepilogo: RiepilogoSerie; corrente: number | undefined }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const colonne = colonneTabella[riepilogo.famiglia] ?? [];
  const intestazioni = riepilogo.righe[0]?.misure.filter(({ id }) => colonne.includes(id)) ?? [];
  const cella = (riga: RigaSerie, id: string): string => {
    const misura = riga.misure.find((m) => m.id === id);
    return misura ? numero(misura.valore, language, 2) : '';
  };
  return (
    <div className='-mx-1 overflow-x-auto'>
      <table className='w-full border-collapse text-xs'>
        <thead>
          <tr className='text-left text-muted-foreground'>
            <th scope='col' className='px-1 py-1 font-normal'>
              {t('serie.size')}
            </th>
            {intestazioni.map(({ id, etichetta }) => (
              <th key={id} scope='col' className='px-1 py-1 text-right font-normal'>
                {(t as Translate)(`serie.measures.${id}` as PlainMessageKey) || etichetta}
              </th>
            ))}
            <th scope='col' className='px-1 py-1 text-right font-normal'>
              {t('serie.weight')}
            </th>
          </tr>
        </thead>
        <tbody className='font-mono tabular-nums'>
          {riepilogo.righe.map((riga) => (
            <tr
              key={riga.nomeFile}
              data-corrente={riga.valore === corrente ? '' : undefined}
              className={cn(
                'border-t border-border',
                riga.valore === corrente && 'bg-titanium/10 text-foreground',
                !riga.costruita && 'text-muted-foreground',
              )}
            >
              <th scope='row' className='px-1 py-1 text-left font-medium'>
                {riga.etichetta}
              </th>
              {intestazioni.map(({ id }) => (
                <td key={id} className='px-1 py-1 text-right'>
                  {riga.costruita ? cella(riga, id) : '·'}
                </td>
              ))}
              <td className='px-1 py-1 text-right'>
                {riga.costruita && riga.pesoGrammi !== undefined ? (
                  <span className='inline-flex items-center justify-end gap-1'>
                    {riga.esiti.length > 0 ? (
                      <TriangleAlert
                        aria-label={riga.esiti.map(({ messaggio }) => messaggio).join(' ')}
                        className={cn(
                          'size-3',
                          riga.esiti.some(({ livello }) => livello === 'blocco') ? 'text-destructive' : 'text-warning',
                        )}
                      />
                    ) : null}
                    {numero(riga.pesoGrammi, language, 2)} g
                  </span>
                ) : (
                  t('serie.notBuilt')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The growth rules and the sources, folded away. */
function RegoleESorgenti({ famiglia }: Readonly<{ famiglia: IdFamiglia }>): React.JSX.Element {
  const { t, language } = useTranslation();
  const regole = regoleDiCrescita(famiglia);
  const asse = t(`serie.growthAxis.${famiglia as 'anello' | 'fondo_semplice' | 'tacco'}`);
  return (
    <details className='text-[11px] leading-4 text-muted-foreground'>
      <summary className='select-none hover:text-foreground'>{t('serie.rules')}</summary>
      <div className='mt-1.5 space-y-1.5'>
        <p className='text-pretty'>{t('serie.rulesNote')}</p>
        <ul className='list-disc space-y-0.5 pl-4'>
          {regole.map((regola) => (
            <li key={regola.chiave} className='text-pretty'>
              {regola.pendenza === 0
                ? t('serie.ruleKeeps', { what: etichettaParametro(famiglia, regola.chiave, language) })
                : t('serie.ruleSlope', {
                    what: etichettaParametro(famiglia, regola.chiave, language),
                    slope: numero(regola.pendenza, language, 3),
                    axis: asse,
                  })}
            </li>
          ))}
        </ul>
        {famiglia === 'anello' ? (
          <>
            <p className='font-medium text-foreground'>{t('serie.sources')}</p>
            <ul className='list-disc space-y-0.5 pl-4'>
              <li>{t('serie.sourcesList.iso')}</li>
              <li>{t('serie.sourcesList.it')}</li>
              <li>{t('serie.sourcesList.us')}</li>
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}

/**
 * The section for a model: size (rings and soles) and series (rings, soles, heels). Presentation only: the container
 * below reads the model and writes the size.
 *
 * @param props - The model, the series state and what a click does.
 * @returns The section.
 */
export function SerieSectionView({
  modello,
  stato,
  intervallo,
  onIntervallo,
  onCambiaTaglia,
  onCalcola,
}: Readonly<{
  modello: SerieModello;
  stato: StatoSerie;
  intervallo: Readonly<{ da: number; a: number }>;
  onIntervallo: (intervallo: Readonly<{ da: number; a: number }>) => void;
  onCambiaTaglia: (valori: { sistema?: SistemaTaglia; valore: number }) => void;
  onCalcola: () => void;
}>): React.JSX.Element {
  const { t, language } = useTranslation();
  const p = modello.parametri as {
    taglia?: { sistema: SistemaTaglia; valore: number };
    pianta?: { taglia: number };
    tacco?: { altezza: number };
  };
  const asse = asseDellaSerie(modello.famiglia, { base: modello.parametri, variante: modello.variante });
  const opzioni = useMemo(() => {
    if (!asse) {
      return [];
    }
    const [minimo, massimo] = asse.intervallo;
    const quanti = Math.min(taglieMassimeSerie * 3, Math.floor((massimo - minimo) / asse.passo) + 1);
    return Array.from({ length: quanti }, (_, k) => Math.round((minimo + k * asse.passo) * 100) / 100);
  }, [asse]);
  const corrente = p.taglia?.valore ?? p.pianta?.taglia ?? p.tacco?.altezza;
  const unita = modello.famiglia === 'tacco' ? ' mm' : '';
  const campo = (etichetta: string, chiave: 'da' | 'a'): React.JSX.Element => (
    <label className='space-y-1 text-xs text-muted-foreground'>
      {etichetta}
      <Select
        size='sm'
        value={comeTesto(intervallo[chiave])}
        onValueChange={(nuovo) => {
          onIntervallo({ ...intervallo, [chiave]: Number(nuovo) });
        }}
      >
        <SelectTrigger className='w-full font-mono text-xs tabular-nums' aria-label={etichetta}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position='popper' className='max-h-64'>
          {opzioni.map((valore) => (
            <SelectItem key={valore} value={comeTesto(valore)} className='font-mono text-xs tabular-nums'>
              {numero(valore, language, 1)}
              {unita}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
  const passoSerie = intervalloConsigliato(modello.famiglia, p.taglia?.sistema)?.passo ?? asse?.passo ?? 1;
  const conteggio = Math.floor((intervallo.a - intervallo.da) / passoSerie + 1e-9) + 1;
  const valido = conteggio >= 1 && conteggio <= taglieMassimeSerie;
  return (
    <section
      aria-label={t('serie.title')}
      className='border-t border-border px-4 pt-3 pb-3'
      data-slot='inspector-series'
    >
      <Eyebrow as='h3'>{t('serie.title')}</Eyebrow>
      <div className='mt-2 space-y-3'>
        {p.taglia ? <TagliaAnello parametri={{ taglia: p.taglia }} onCambia={onCambiaTaglia} /> : null}
        {p.pianta ? (
          <TagliaFondo
            taglia={p.pianta.taglia}
            onCambia={(valore) => {
              onCambiaTaglia({ valore });
            }}
          />
        ) : null}
        <div className={cn('space-y-2', (p.taglia ?? p.pianta) && 'border-t border-border pt-3')}>
          <Eyebrow as='p'>{t('serie.series')}</Eyebrow>
          <div className='grid grid-cols-2 gap-2'>
            {campo(t('serie.from'), 'da')}
            {campo(t('serie.to'), 'a')}
          </div>
          <Button
            type='button'
            size='xs'
            variant={stato.stato === 'pronto' ? 'outline' : 'default'}
            disabled={stato.stato === 'in_corso' || !valido}
            onClick={onCalcola}
          >
            {stato.stato === 'in_corso' ? <LoaderCircle aria-hidden className='size-3.5 animate-spin' /> : null}
            {stato.stato === 'pronto' ? t('serie.recompute') : t('serie.compute')}
          </Button>
          {stato.stato === 'in_corso' ? (
            <p role='status' className='text-xs text-muted-foreground'>
              {t('serie.computing', { count: stato.conteggio })}
            </p>
          ) : null}
          {stato.stato === 'errore' ? (
            <p className='text-xs text-muted-foreground'>
              {t('serie.failed')}{' '}
              <button type='button' className='text-foreground underline underline-offset-2' onClick={onCalcola}>
                {t('serie.retry')}
              </button>
            </p>
          ) : null}
          {stato.stato === 'pronto' ? (
            <>
              <TabellaSerie riepilogo={stato.riepilogo} corrente={corrente} />
              <ScaricaCsv riepilogo={stato.riepilogo} />
            </>
          ) : null}
          <RegoleESorgenti famiglia={modello.famiglia} />
        </div>
      </div>
    </section>
  );
}

function ScaricaCsv({ riepilogo }: Readonly<{ riepilogo: RiepilogoSerie }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Button
      type='button'
      size='xs'
      variant='outline'
      onClick={() => {
        const url = URL.createObjectURL(new Blob([csvSerie(riepilogo)], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `${t('serie.csvName', { family: riepilogo.famiglia })}.csv`;
        link.click();
        URL.revokeObjectURL(url);
      }}
    >
      <Download aria-hidden className='size-3.5' />
      {t('serie.csv')}
    </Button>
  );
}

/**
 * The section in the inspector: for a model built from a family that has sizes or a series (ring, sole, heel);
 * nothing for any other model. The size is written in one go as the Measures would; the series is built by the
 * variants worker, one row per size.
 *
 * @returns The section, or undefined.
 */
export function InspectorSerie(): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const { parameterService } = useProject();
  const modello = useAssistantModel(undefined);
  const { famiglia } = modello;
  const id = famiglia?.definizione.id;
  const sistema = (famiglia?.parametri as { taglia?: { sistema: SistemaTaglia } } | undefined)?.taglia?.sistema;
  const consigliato = id ? intervalloConsigliato(id, sistema) : undefined;
  const [stato, setStato] = useState<StatoSerie>({ stato: 'inattivo' });
  const [scelto, setScelto] = useState<{ chiave: string; da: number; a: number }>();
  const corsa = useRef(0);
  const chiave = `${id ?? ''}:${sistema ?? ''}`;
  // The range follows the family and the ring's system until the designer picks another.
  const intervallo =
    scelto?.chiave === chiave ? { da: scelto.da, a: scelto.a } : { da: consigliato?.da ?? 0, a: consigliato?.a ?? 0 };

  const cambiaTaglia = useCallback(
    (valori: { sistema?: SistemaTaglia; valore: number }) => {
      const { manifest } = modello;
      if (!manifest || !famiglia) {
        return;
      }
      const dopo = structuredClone(modello.valori) as Record<string, unknown>;
      const taglia = (dopo['taglia'] ?? {}) as Record<string, unknown>;
      const pianta = (dopo['pianta'] ?? {}) as Record<string, unknown>;
      if (famiglia.definizione.id === 'anello') {
        dopo['taglia'] = { ...taglia, ...(valori.sistema ? { sistema: valori.sistema } : {}), valore: valori.valore };
      } else {
        dopo['pianta'] = { ...pianta, taglia: valori.valore };
      }
      // async-iife: bootstrap -- one write of the active group, as every measure change; a failure is a message.
      void (async (): Promise<void> => {
        try {
          await parameterService.replaceValues(modello.entryPath, manifest, dopo);
          setStato({ stato: 'inattivo' });
        } catch (error) {
          console.error('Failed to change the size:', error);
          toast.error(t('serie.applyFailed'));
        }
      })();
    },
    [famiglia, modello, parameterService, t],
  );

  const calcola = useCallback(() => {
    if (!famiglia || !id) {
      return;
    }
    const questa = ++corsa.current;
    const passo = consigliato?.passo ?? 1;
    setStato({ stato: 'in_corso', conteggio: Math.floor((intervallo.a - intervallo.da) / passo + 1e-9) + 1 });
    // async-iife: bootstrap -- the worker answers once; an answer from an older click is dropped.
    void (async (): Promise<void> => {
      try {
        const riepilogo = await prendiValutatoreVarianti().serie({
          famiglia: id,
          variante: famiglia.variante,
          base: famiglia.parametri,
          da: intervallo.da,
          a: intervallo.a,
          passo,
          ...(sistema ? { sistema } : {}),
        });
        if (corsa.current === questa) {
          setStato({ stato: 'pronto', riepilogo });
        }
      } catch (error) {
        console.error('Failed to build the series:', error);
        if (corsa.current === questa) {
          setStato({ stato: 'errore' });
        }
      }
    })();
  }, [consigliato?.passo, famiglia, id, intervallo.a, intervallo.da, sistema]);

  if (!famiglia || !id || !famiglieConSerie.includes(id)) {
    return undefined;
  }
  return (
    <SerieSectionView
      modello={{ famiglia: id, variante: famiglia.variante, parametri: famiglia.parametri }}
      stato={stato}
      intervallo={intervallo}
      onIntervallo={(prossimo) => {
        setScelto({ chiave, ...prossimo });
      }}
      onCambiaTaglia={cambiaTaglia}
      onCalcola={calcola}
    />
  );
}
