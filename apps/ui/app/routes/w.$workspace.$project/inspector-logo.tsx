import { useCallback, useMemo, useRef, useState } from 'react';
import { ImageUp, LockKeyhole, Trash2 } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@taucad/ui/components/select';
import { cn } from '@taucad/ui/utils/cn';
import { ErroreLogo, leggiLogoSvg, percorsoLogo, svgDaLogo } from '@taucad/smlib/famiglie';
import type { Esito, LogoLetto } from '@taucad/smlib/famiglie';
import { Eyebrow } from '#components/ui/eyebrow.js';
import { toast } from '#components/ui/sonner.js';
import { useAssistantModel } from '#hooks/use-assistant-model.js';
import { useProject } from '#hooks/use-project.js';
import { useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import { useProducibilita } from '#routes/w.$workspace.$project/producibilita-context.js';

/**
 * The logo of a plate in the inspector (E3b): «Carica SVG» (button or drop), a small preview drawn from the outlines
 * the parser read (the user's SVG text never reaches the DOM nor an `<img>`), «Rimuovi», and the mode, width, depth
 * and position of the logo. What is saved in `logo.svg` is a clean compact rewrite of the outlines (one path, no
 * script, no style, no external element), never the uploaded text. The warnings of the checks (`SVG_*`, `LOGO_*`,
 * `TRATTO_MIN_LOGO`, `SFORMO_LOGO`) sit under the field.
 */

/** The biggest file read (bytes). */
export const dimensioneMassimaLogo = 200 * 1024;

const codiciLogo = /^(SVG_|LOGO_|TRATTO_MIN_LOGO|SFORMO_LOGO)/u;

/** What a file becomes: the clean SVG to save and the outlines read, or the key of the message that says why not. */
export type EsitoCaricamento =
  | Readonly<{ ok: true; svg: string; logo: LogoLetto }>
  | Readonly<{
      ok: false;
      errore: 'tooBig' | 'notSvg' | 'SVG_NON_VALIDO' | 'SVG_VUOTO' | 'SVG_APERTO' | 'SVG_AUTOINTERSECANTE';
    }>;

/**
 * Read an uploaded file as a logo: size, text only, then the geometry through the parser and a clean rewrite.
 *
 * @param file - The file picked or dropped.
 * @returns The clean SVG and the outlines, or why the file was refused.
 */
export async function leggiFileLogo(file: Pick<File, 'name' | 'size' | 'type' | 'text'>): Promise<EsitoCaricamento> {
  if (file.size > dimensioneMassimaLogo) {
    return { ok: false, errore: 'tooBig' };
  }
  if (!/\.svg$/iu.test(file.name) && file.type !== 'image/svg+xml') {
    return { ok: false, errore: 'notSvg' };
  }
  const testo = await file.text();
  if (testo.length > dimensioneMassimaLogo || testo.includes('\u0000')) {
    return { ok: false, errore: 'notSvg' };
  }
  try {
    const logo = leggiLogoSvg(testo);
    const svg = svgDaLogo(logo);
    // What is saved is what is previewed: the clean rewrite, read again.
    return { ok: true, svg, logo: leggiLogoSvg(svg) };
  } catch (error) {
    return { ok: false, errore: error instanceof ErroreLogo ? error.codice : 'SVG_NON_VALIDO' };
  }
}

/** The preview: the outlines as one path, even-odd, in the theme's foreground. */
export function AnteprimaLogo({ logo }: Readonly<{ logo: LogoLetto }>): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <svg
      role='img'
      aria-label={t('serie.logo.preview')}
      viewBox={`0 0 ${logo.larghezza} ${logo.altezza}`}
      preserveAspectRatio='xMidYMid meet'
      className='h-full w-full text-titanium-foreground'
    >
      <path d={percorsoLogo(logo)} fill='currentColor' fillRule='evenodd' />
    </svg>
  );
}

type Valori = Readonly<{
  modo: 'rilievo' | 'inciso' | 'nessuno';
  larghezza: number;
  profondita: number;
  x: number;
  y: number;
}>;

function Numero({
  etichetta,
  valore,
  min,
  max,
  passo,
  onCommit,
}: Readonly<{
  etichetta: string;
  valore: number;
  min: number;
  max: number;
  passo: number;
  onCommit: (valore: number) => void;
}>): React.JSX.Element {
  const [bozza, setBozza] = useState<string>();
  const applica = (): void => {
    const numero = Number(bozza?.replace(',', '.'));
    setBozza(undefined);
    if (bozza !== undefined && Number.isFinite(numero) && numero !== valore) {
      onCommit(Math.min(max, Math.max(min, numero)));
    }
  };
  return (
    <label className='space-y-1 text-xs text-muted-foreground'>
      {etichetta}
      <input
        type='number'
        inputMode='decimal'
        min={min}
        max={max}
        step={passo}
        value={bozza ?? String(valore)}
        className='h-8 w-full rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground tabular-nums focus-visible:focus-outline'
        onChange={(evento) => {
          setBozza(evento.target.value);
        }}
        onBlur={applica}
        onKeyDown={(evento) => {
          if (evento.key === 'Enter') {
            applica();
          }
        }}
      />
    </label>
  );
}

/**
 * The section's body, for a plate: presentation only (the container below reads and writes the model).
 *
 * @param props - The logo read (or none), its values, the checks and what a change does.
 * @returns The section.
 */
export function LogoSectionView({
  logo,
  isLocked,
  valori,
  esiti,
  errore,
  onFile,
  onRimuovi,
  onValori,
}: Readonly<{
  logo: LogoLetto | undefined;
  isLocked: boolean;
  valori: Valori;
  esiti: readonly Esito[];
  errore: string | undefined;
  onFile: (file: File) => void;
  onRimuovi: () => void;
  onValori: (cambio: Partial<Valori>) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  return (
    <section
      aria-label={t('serie.logo.title')}
      className='border-t border-border px-4 pt-3 pb-3'
      data-slot='inspector-logo'
    >
      <div className='flex items-center justify-between gap-2'>
        <Eyebrow as='h3'>{t('serie.logo.title')}</Eyebrow>
        {logo && isLocked ? (
          <LockKeyhole aria-label={t('serie.logo.locked')} className='size-3 text-titanium-foreground'>
            <title>{t('serie.logo.locked')}</title>
          </LockKeyhole>
        ) : null}
      </div>
      <div
        className={cn(
          'mt-2 flex items-center gap-3 rounded-lg border border-dashed border-border p-2',
          isOver && 'border-titanium bg-titanium/10',
        )}
        onDragOver={(evento) => {
          evento.preventDefault();
          setIsOver(true);
        }}
        onDragLeave={() => {
          setIsOver(false);
        }}
        onDrop={(evento) => {
          evento.preventDefault();
          setIsOver(false);
          const file = evento.dataTransfer.files[0];
          if (file) {
            onFile(file);
          }
        }}
      >
        <div className='size-14 shrink-0 rounded-md border border-border bg-background p-1.5'>
          {logo ? <AnteprimaLogo logo={logo} /> : null}
        </div>
        <div className='min-w-0 flex-1 space-y-1.5'>
          {logo ? null : (
            <p className='text-[11px] leading-4 text-pretty text-muted-foreground'>{t('serie.logo.drop')}</p>
          )}
          <div className='flex flex-wrap gap-1.5'>
            <Button
              type='button'
              size='xs'
              variant={logo ? 'outline' : 'default'}
              onClick={() => {
                input.current?.click();
              }}
            >
              <ImageUp aria-hidden className='size-3.5' />
              {logo ? t('serie.logo.replace') : t('serie.logo.upload')}
            </Button>
            {logo ? (
              <Button type='button' size='xs' variant='outline' onClick={onRimuovi}>
                <Trash2 aria-hidden className='size-3.5' />
                {t('serie.logo.remove')}
              </Button>
            ) : null}
          </div>
        </div>
        <input
          ref={input}
          type='file'
          accept='.svg,image/svg+xml'
          className='sr-only'
          aria-label={t('serie.logo.upload')}
          tabIndex={-1}
          onChange={(evento) => {
            const file = evento.target.files?.[0];
            evento.target.value = '';
            if (file) {
              onFile(file);
            }
          }}
        />
      </div>
      {errore ? (
        <p role='alert' className='mt-1.5 text-xs text-destructive'>
          {errore}
        </p>
      ) : null}
      {logo ? (
        <div className='mt-3 space-y-2'>
          <label className='block space-y-1 text-xs text-muted-foreground'>
            {t('serie.logo.mode')}
            <Select
              size='sm'
              value={valori.modo === 'inciso' ? 'inciso' : 'rilievo'}
              onValueChange={(modo) => {
                onValori({ modo: modo as Valori['modo'] });
              }}
            >
              <SelectTrigger className='w-full text-xs' aria-label={t('serie.logo.mode')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position='popper'>
                <SelectItem value='rilievo'>{t('serie.logo.modes.rilievo')}</SelectItem>
                <SelectItem value='inciso'>{t('serie.logo.modes.inciso')}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className='grid grid-cols-2 gap-2'>
            <Numero
              etichetta={t('serie.logo.width')}
              valore={valori.larghezza}
              min={2}
              max={80}
              passo={0.5}
              onCommit={(larghezza) => {
                onValori({ larghezza });
              }}
            />
            <Numero
              etichetta={t('serie.logo.depth')}
              valore={valori.profondita}
              min={0.2}
              max={1.5}
              passo={0.05}
              onCommit={(profondita) => {
                onValori({ profondita });
              }}
            />
            <Numero
              etichetta={t('serie.logo.x')}
              valore={valori.x}
              min={-60}
              max={60}
              passo={0.5}
              onCommit={(x) => {
                onValori({ x });
              }}
            />
            <Numero
              etichetta={t('serie.logo.y')}
              valore={valori.y}
              min={-30}
              max={30}
              passo={0.5}
              onCommit={(y) => {
                onValori({ y });
              }}
            />
          </div>
          {esiti.length > 0 ? (
            <ul className='space-y-0.5 text-xs'>
              {esiti.map((esito) => (
                <li key={`${esito.codice}-${esito.messaggio}`} className='flex items-start gap-1.5 leading-5'>
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      esito.livello === 'blocco' ? 'bg-destructive' : 'bg-warning',
                    )}
                  />
                  {esito.messaggio}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : esiti.length > 0 ? (
        <ul className='mt-1.5 space-y-0.5 text-xs'>
          {esiti.map((esito) => (
            <li key={`${esito.codice}-${esito.messaggio}`}>{esito.messaggio}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The logo section in the inspector: only for a model built from the plate family.
 *
 * @returns The section, or undefined.
 */
export function InspectorLogo(): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const { parameterService } = useProject();
  const modello = useAssistantModel(undefined);
  const producibilita = useProducibilita();
  const [errore, setErrore] = useState<string>();
  const { famiglia } = modello;
  const parametri = famiglia?.parametri as { logo?: { svg: string } & Valori } | undefined;
  const svg = parametri?.logo?.svg ?? '';
  const logo = useMemo((): LogoLetto | undefined => {
    if (svg.trim() === '') {
      return undefined;
    }
    try {
      return leggiLogoSvg(svg);
    } catch {
      return undefined;
    }
  }, [svg]);

  const scrivi = useCallback(
    async (cambio: Record<string, unknown>): Promise<void> => {
      const { manifest } = modello;
      if (!manifest) {
        return;
      }
      const dopo = structuredClone(modello.valori) as Record<string, unknown>;
      const attuale = (dopo['logo'] ?? {}) as Record<string, unknown>;
      dopo['logo'] = { ...attuale, ...cambio };
      try {
        await parameterService.replaceValues(modello.entryPath, manifest, dopo);
      } catch (error) {
        console.error('Failed to save the logo:', error);
        toast.error(t('serie.logo.applyFailed'));
      }
    },
    [modello, parameterService, t],
  );

  const onFile = useCallback(
    (file: File) => {
      // async-iife: bootstrap -- the file is read once; a refusal is a message under the field, never a write.
      void (async (): Promise<void> => {
        const esito = await leggiFileLogo(file);
        if (!esito.ok) {
          setErrore(t(`serie.logo.errors.${esito.errore}` as PlainMessageKey));
          return;
        }
        setErrore(undefined);
        await scrivi({ svg: esito.svg, ...(parametri?.logo?.modo === 'nessuno' ? { modo: 'rilievo' } : {}) });
      })();
    },
    [parametri?.logo?.modo, scrivi, t],
  );

  if (famiglia?.definizione.id !== 'placca' || !parametri?.logo) {
    return undefined;
  }
  const esiti = (producibilita?.controlli ?? []).filter(
    ({ codice, livello }) => codiciLogo.test(codice) && (livello === 'avviso' || livello === 'blocco'),
  );
  return (
    <LogoSectionView
      logo={logo}
      isLocked={modello.bloccati.includes('logo.svg')}
      valori={parametri.logo}
      esiti={esiti}
      errore={errore}
      onFile={onFile}
      onRimuovi={() => {
        setErrore(undefined);
        void scrivi({ svg: '' });
      }}
      onValori={(cambio) => {
        void scrivi(cambio);
      }}
    />
  );
}
