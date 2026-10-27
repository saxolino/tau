import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LibraryBigIcon, MessagesSquareIcon } from 'lucide-react';
import { randomUuid } from '@taucad/utils/id';
import { Button } from '@taucad/ui/components/button';
import { Input } from '@taucad/ui/components/input';
import { toast } from '#components/ui/sonner.js';
import { useProject } from '#hooks/use-project.js';
import { useSinopiaCadLink } from '#hooks/use-sinopia-cad-sync.js';
import { useSinopiaSendEvents } from '#hooks/use-sinopia-send-events.js';
import { useTranslation } from '#i18n/translate.js';
import { misureLibreria } from '#lib/consegna.js';
import type { PezzoDellaConsegna } from '#lib/consegna.js';
import { pezzoPiano } from '@taucad/smlib/consegna';
import type { PreparedExport } from '#services/project-export.types.js';
import type { ProjectExportRows } from '#services/project-export.js';
import {
  SinopiaConsegnaError,
  allegatiCadAmmessi,
  stepAllegabile,
  chiediPreventivo,
  fornitoriPerTipo,
  isTipoPezzo,
  libreriaConFileCad,
  salvaInLibreria,
  testoPreventivo,
  tipiPezzoPreventivo,
} from '#services/sinopia-consegna.js';
import type { TipoPezzo } from '#services/sinopia-consegna.js';

/** Sinopia's own address, where the Library and the single inbox live. */
const sinopiaOrigin = 'https://sinopialab.com';

type Props = Readonly<{
  name: string;
  rows: ProjectExportRows;
  selectedNames: string[] | undefined;
  capture: (signal: AbortSignal) => Promise<PreparedExport>;
  pieces: readonly PezzoDellaConsegna[];
  partType: TipoPezzo | undefined;
}>;

const fileOf = (result: PreparedExport | undefined, ...statuses: Array<'verified' | 'ready'>) =>
  result && result.status !== 'needsFix' && statuses.includes(result.status) ? result.files[0] : undefined;

/**
 * The delivery to Sinopia inside Esporta (E3a): «Salva in Libreria» (only once Sinopia's Library holds CAD files) and
 * «Chiedi preventivo» to the suppliers of the part type. Both reuse the files the rows above prepared for the chosen
 * pieces; the photo is taken at the click.
 */
export function ProjectDeliverySection({
  name,
  rows,
  selectedNames,
  capture,
  pieces,
  partType,
}: Props): React.JSX.Element {
  const { t, language } = useTranslation();
  const link = useSinopiaCadLink();
  const { projectId } = useProject();
  const { events } = useSinopiaSendEvents(projectId);
  const sectionAbort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    sectionAbort.current = controller;
    return () => {
      controller.abort();
    };
  }, []);
  // Fail-closed: the entry appears only once the Library's CAD columns answer for this account.
  const library = useQuery({
    queryKey: ['sinopia-library-cad-columns', link?.userId],
    queryFn: async () => libreriaConFileCad(),
    enabled: link !== undefined,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [busy, setBusy] = useState<'library' | 'quote'>();
  const [isQuoteOpen, setQuoteOpen] = useState(false);
  const chosen = useMemo(
    () => (selectedNames ? pieces.filter(({ nome }) => selectedNames.includes(nome)) : pieces),
    [pieces, selectedNames],
  );
  const step = fileOf(rows.step, 'verified');
  const measured = rows.step?.status === 'verified' ? rows.step.measured : undefined;
  const failure = (error: unknown): void => {
    const problema = error instanceof SinopiaConsegnaError ? error.problema : 'failed';
    toast.error(t(`consegna.errors.${problema}`));
  };

  const saveToLibrary = async (): Promise<void> => {
    const signal = sectionAbort.current?.signal;
    if (!link || !signal || busy) {
      return;
    }
    if (!step || !measured) {
      toast.error(t('consegna.library.needsStep'));
      return;
    }
    setBusy('library');
    try {
      const photo = await capture(signal);
      const piano = chosen.every((pezzo) => pezzo.piano) || pezzoPiano(measured.size);
      const { larghezza, altezza } = misureLibreria(measured.size, piano);
      const [primo] = chosen;
      await salvaInLibreria({
        link,
        step,
        glb: fileOf(rows.glb, 'ready'),
        foto: fileOf(photo, 'ready'),
        nome: selectedNames?.length === 1 ? `${name} · ${selectedNames[0]!}` : name,
        tipo: partType,
        ...(primo?.materiale
          ? {
              materiale: { chiave: primo.materiale.chiave, nome: primo.materiale.nome, colore: primo.materiale.colore },
            }
          : {}),
        larghezza,
        altezza,
        ingombro: measured.size,
        pezzi: chosen.map((pezzo) => ({
          nome: pezzo.nome,
          ...(pezzo.materiale ? { materiale: pezzo.materiale.chiave } : {}),
          ...(pezzo.processo ? { processo: pezzo.processo } : {}),
          ...(pezzo.pesoGrammi === undefined ? {} : { pesoGrammi: pezzo.pesoGrammi }),
        })),
        signal,
      });
      toast.success(t('consegna.library.saved'), {
        action: {
          label: t('consegna.library.open'),
          onClick: () => {
            globalThis.open(`${sinopiaOrigin}/library`, '_blank', 'noopener,noreferrer');
          },
        },
      });
    } catch (error) {
      if (!signal.aborted) {
        failure(error);
      }
    } finally {
      if (!signal.aborted) {
        setBusy(undefined);
      }
    }
  };

  const canSave = library.data === true && link !== undefined;
  return (
    <section aria-label={t('consegna.title')} className='space-y-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 className='mr-auto text-sm font-semibold'>{t('consegna.title')}</h3>
        {canSave ? (
          <Button
            variant='outline'
            size='sm'
            className='pointer-coarse:min-h-11'
            aria-busy={busy === 'library'}
            disabled={busy !== undefined || !step}
            title={t('consegna.library.hint')}
            onClick={() => {
              void saveToLibrary();
            }}
          >
            <LibraryBigIcon aria-hidden />
            {busy === 'library' ? t('consegna.library.saving') : t('consegna.library.save')}
          </Button>
        ) : null}
        <Button
          variant={isQuoteOpen ? 'secondary' : 'outline'}
          size='sm'
          className='pointer-coarse:min-h-11'
          aria-expanded={isQuoteOpen}
          disabled={!link}
          onClick={() => {
            setQuoteOpen((value) => !value);
          }}
        >
          <MessagesSquareIcon aria-hidden />
          {t('consegna.quote.ask')}
        </Button>
      </div>
      {link ? null : <p className='text-xs text-muted-foreground'>{t('consegna.quote.unlinked')}</p>}
      {isQuoteOpen && link ? (
        <QuotePanel
          link={link}
          name={name}
          rows={rows}
          capture={capture}
          pieces={chosen}
          partType={partType}
          lastVersion={Math.max(0, ...events.map(({ versionNumber }) => versionNumber)) || undefined}
          busy={busy}
          setBusy={setBusy}
          sectionAbort={sectionAbort}
          language={language}
          onDone={() => {
            setQuoteOpen(false);
          }}
          onFailure={failure}
        />
      ) : null}
    </section>
  );
}

function QuotePanel({
  link,
  name,
  rows,
  capture,
  pieces,
  partType,
  lastVersion,
  busy,
  setBusy,
  sectionAbort,
  language,
  onDone,
  onFailure,
}: Readonly<{
  link: NonNullable<ReturnType<typeof useSinopiaCadLink>>;
  name: string;
  rows: ProjectExportRows;
  capture: Props['capture'];
  pieces: readonly PezzoDellaConsegna[];
  partType: TipoPezzo | undefined;
  lastVersion: number | undefined;
  busy: 'library' | 'quote' | undefined;
  setBusy: (value: 'library' | 'quote' | undefined) => void;
  sectionAbort: React.RefObject<AbortController | undefined>;
  language: 'it' | 'en';
  onDone: () => void;
  onFailure: (error: unknown) => void;
}>): React.JSX.Element {
  const { t } = useTranslation();
  const [type, setType] = useState<TipoPezzo | undefined>(partType);
  const [supplierId, setSupplierId] = useState<string>();
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const clientId = useRef(randomUuid());
  const suppliers = useQuery({
    queryKey: ['sinopia-quote-suppliers', link.userId, type],
    queryFn: async () => (type ? fornitoriPerTipo(type) : []),
    enabled: type !== undefined,
    retry: false,
    staleTime: 60_000,
  });
  const supplier = suppliers.data?.find(({ id }) => id === supplierId);
  const sheet = fileOf(rows.pdf, 'ready');
  const step = fileOf(rows.step, 'verified');
  // Fail-closed: the STEP goes with the message only once the inbox admits CAD files.
  const cadAttachments = useQuery({
    queryKey: ['sinopia-inbox-cad-attachments', link.userId],
    queryFn: async () => allegatiCadAmmessi(),
    retry: false,
    staleTime: 5 * 60_000,
  });
  // The STEP is expected to travel only when the inbox admits it and it is within the limit; the server may still refuse.
  const stepAtteso = cadAttachments.data === true && stepAllegabile(step);
  const measured = rows.step?.status === 'verified' ? rows.step.measured : undefined;

  const send = async (): Promise<void> => {
    const signal = sectionAbort.current?.signal;
    if (!signal || !supplier || !type || busy) {
      return;
    }
    setBusy('quote');
    try {
      const photo = fileOf(await capture(signal), 'ready');
      const amount = Number.parseInt(quantity, 10);
      // The step file is named after the project, as the supplier will save it.
      const stepFile = step ? { ...step, name: `${name}.step` } : undefined;
      const testo = (stepAllegato: boolean): string =>
        testoPreventivo({
          progetto: name,
          tipo: t(`consegna.quote.types.${type}`),
          quantita: Number.isFinite(amount) && amount > 0 ? amount : undefined,
          nota: note,
          pezzi: pieces.map((pezzo) => {
            const size = measured?.pieces.find((piece) => piece.name === pezzo.nome)?.size;
            return {
              nome: pezzo.nome,
              ...(pezzo.materiale ? { materiale: pezzo.materiale.nome } : {}),
              ...(pezzo.processo ? { processo: t(`producibilita.processes.${pezzo.processo}`) } : {}),
              ...(pezzo.pesoGrammi === undefined ? {} : { pesoGrammi: pezzo.pesoGrammi }),
              ...(size ? { ingombro: size } : {}),
            };
          }),
          misure: [],
          allegati: [sheet?.name, photo?.name, stepAllegato ? stepFile?.name : undefined].filter(
            (nome): nome is string => Boolean(nome),
          ),
          ...(lastVersion === undefined ? {} : { versione: lastVersion }),
          stepAllegato,
          lingua: language,
        });
      const { conversazione: conversation, stepAllegato } = await chiediPreventivo({
        link,
        fornitoreId: supplier.id,
        testo,
        file: [sheet, photo].filter((file): file is NonNullable<typeof file> => file !== undefined),
        ...(stepFile ? { step: stepFile } : {}),
        clientId: clientId.current,
        signal,
      });
      clientId.current = randomUuid();
      // Say what went: the STEP only when it really travelled; a STEP that was expected and stayed behind is named.
      const inviato = stepAllegato
        ? t('consegna.quote.sentWithStep', { supplier: supplier.nome })
        : stepAtteso
          ? t('consegna.quote.sentWithoutStep', { supplier: supplier.nome })
          : t('consegna.quote.sent', { supplier: supplier.nome });
      toast.success(inviato, {
        action: {
          label: t('consegna.quote.openConversation'),
          onClick: () => {
            globalThis.open(
              `${sinopiaOrigin}/messages?origin=rete&conversation=${encodeURIComponent(conversation)}`,
              '_blank',
              'noopener,noreferrer',
            );
          },
        },
      });
      onDone();
    } catch (error) {
      if (!signal.aborted) {
        onFailure(error);
      }
    } finally {
      if (!signal.aborted) {
        setBusy(undefined);
      }
    }
  };

  return (
    <div className='space-y-3 rounded-md border bg-muted/40 p-3 text-sm'>
      <label className='flex flex-wrap items-center gap-2'>
        <span className='text-xs text-muted-foreground'>{t('consegna.quote.type')}</span>
        <select
          className='h-8 min-w-0 rounded-md border bg-background px-2 text-sm pointer-coarse:min-h-11'
          value={type ?? ''}
          onChange={(event) => {
            setType(isTipoPezzo(event.target.value) ? event.target.value : undefined);
            setSupplierId(undefined);
          }}
        >
          <option value='' disabled>
            {t('consegna.quote.chooseType')}
          </option>
          {tipiPezzoPreventivo.map((code) => (
            <option key={code} value={code}>
              {t(`consegna.quote.types.${code}`)}
            </option>
          ))}
        </select>
      </label>
      {type ? (
        <fieldset className='space-y-1.5'>
          <legend className='text-xs text-muted-foreground'>
            {t('consegna.quote.suppliers', { type: t(`consegna.quote.types.${type}`) })}
          </legend>
          {suppliers.isPending ? (
            <p role='status' aria-busy className='text-xs text-muted-foreground'>
              {t('consegna.quote.loading')}
            </p>
          ) : null}
          {suppliers.isError ? (
            <p role='alert' className='text-xs'>
              {t('consegna.errors.failed')}
            </p>
          ) : null}
          {suppliers.data?.length === 0 ? (
            <p className='text-xs text-muted-foreground'>{t('consegna.quote.none')}</p>
          ) : null}
          {suppliers.data && suppliers.data.length > 0 ? (
            <ul className='max-h-36 divide-y overflow-y-auto rounded-md border bg-background'>
              {suppliers.data.map((item) => (
                <li key={item.id}>
                  <label className='flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/60'>
                    <input
                      type='radio'
                      name='quote-supplier'
                      className='accent-primary'
                      checked={supplierId === item.id}
                      onChange={() => {
                        setSupplierId(item.id);
                      }}
                    />
                    <span className='min-w-0 flex-1 truncate'>
                      {item.nome}
                      {item.luogo ? <span className='text-muted-foreground'> · {item.luogo}</span> : null}
                    </span>
                    <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                      {item.prodotti === 1
                        ? t('consegna.quote.productsOne')
                        : t('consegna.quote.products', { count: item.prodotti })}
                      {item.demo ? ` · ${t('consegna.quote.demo')}` : ''}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </fieldset>
      ) : null}
      <div className='grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]'>
        <label className='grid gap-1'>
          <span className='text-xs text-muted-foreground'>{t('consegna.quote.quantity')}</span>
          <Input
            inputMode='numeric'
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value.replaceAll(/\D/gu, '').slice(0, 7));
            }}
          />
        </label>
        <label className='grid gap-1'>
          <span className='text-xs text-muted-foreground'>{t('consegna.quote.note')}</span>
          <Input
            value={note}
            maxLength={1000}
            placeholder={t('consegna.quote.notePlaceholder')}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
      </div>
      <p className='text-xs text-muted-foreground'>
        {stepAtteso ? t('consegna.quote.attachmentsWithStep') : t('consegna.quote.attachments')}
      </p>
      <div className='flex flex-wrap items-center justify-end gap-2'>
        <Button variant='ghost' size='sm' className='pointer-coarse:min-h-11' onClick={onDone}>
          {t('consegna.quote.close')}
        </Button>
        <Button
          size='sm'
          className='h-auto min-h-8 whitespace-normal pointer-coarse:min-h-11'
          aria-busy={busy === 'quote'}
          disabled={!supplier || !sheet || busy !== undefined}
          onClick={() => {
            void send();
          }}
        >
          {busy === 'quote'
            ? t('consegna.quote.sending')
            : t('consegna.quote.send', { supplier: supplier?.nome ?? '…' })}
        </Button>
      </div>
    </div>
  );
}
