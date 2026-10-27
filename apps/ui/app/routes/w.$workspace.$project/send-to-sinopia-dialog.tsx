import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { randomUuid } from '@taucad/utils/id';
import { Button } from '@taucad/ui/components/button';
import { Checkbox } from '@taucad/ui/components/checkbox';
import { Input } from '@taucad/ui/components/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@taucad/ui/components/dialog';
import { useProject } from '#hooks/use-project.js';
import { useFileManager } from '#hooks/use-file-manager.js';
import { useProjectExport } from '#hooks/use-project-export.js';
import { useTranslation } from '#i18n/translate.js';
import { getSinopiaDataClient } from '#lib/sinopia-data-client.js';
import {
  sinopiaSender,
  SinopiaSendError,
  recordSinopiaDelivery,
  readPendingSinopiaDelivery,
  writePendingSinopiaDelivery,
  sinopiaPendingPath,
  selectedSinopiaFiles,
} from '#services/sinopia-send.js';
import type {
  SinopiaSendFiles,
  SinopiaSendFormat,
  SinopiaSendReceipt,
  PendingSinopiaDelivery,
} from '#services/sinopia-send.js';
import { getSinopiaCadModel } from '#services/sinopia-cad.js';
import type { SinopiaCadLink } from '#services/sinopia-cad.js';
import type { PlainMessageKey } from '#i18n/translate.js';
import type { SinopiaCadLinking } from '#hooks/use-sinopia-cad-sync.js';
import { toast } from '#components/ui/sonner.js';

const baseFormats: SinopiaSendFormat[] = ['step', 'glb', 'photo'];
/** SMLib models also send the PDF sheet (E3a). */
const deliveryFormats: SinopiaSendFormat[] = [...baseFormats, 'pdf'];
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

/** The unlinked model's way in: the same project creation the save status starts when the model opens. */
type Linking = Readonly<{ name: string; state: SinopiaCadLinking | undefined; start: () => void }>;

type Props = {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly link: SinopiaCadLink | undefined;
  readonly linking?: Linking;
};

/** One explicit handoff, with a destination owned by the admitted account and actual prepared formats. */
export function SendToSinopiaDialog({ isOpen, onOpenChange, link, linking }: Props): React.JSX.Element | undefined {
  if (!isOpen) {
    return undefined;
  }
  if (!link) {
    return <UnlinkedSendDialog linking={linking} onOpenChange={onOpenChange} />;
  }
  return (
    <LinkedSendDialog
      key={`${link.userId}:${link.modelId}:${link.projectId}`}
      link={link}
      onOpenChange={onOpenChange}
    />
  );
}

/** Never a dead end: a model still without its Sinopia project offers to create it, then the send form follows. */
function UnlinkedSendDialog({
  linking,
  onOpenChange,
}: {
  readonly linking: Linking | undefined;
  readonly onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const isCreating = linking?.state === 'linking';
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sinopiaSend.title')}</DialogTitle>
          <DialogDescription>{t('sinopiaSend.unlinked')}</DialogDescription>
        </DialogHeader>
        {linking?.state === 'failed' ? (
          <p role='alert' className='text-sm'>
            {t('sinopiaSend.createFailed')}
          </p>
        ) : null}
        {isCreating ? (
          <p role='status' aria-busy className='text-sm'>
            {t('sinopiaSend.creating')}
          </p>
        ) : null}
        <div className='flex flex-wrap justify-end gap-2 border-t pt-4'>
          <Button
            variant='outline'
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('sinopiaSend.cancel')}
          </Button>
          <Button
            className='h-auto min-h-8 whitespace-normal'
            disabled={isCreating || !linking?.name}
            aria-busy={isCreating}
            onClick={() => {
              linking?.start();
            }}
          >
            {t('sinopiaSend.createProject', { name: linking?.name ?? '' })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LinkedSendDialog({
  link,
  onOpenChange,
}: {
  readonly link: SinopiaCadLink;
  readonly onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { projectId } = useProject();
  const { recordFiles } = useFileManager();
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['sinopia-send-pending', projectId, link.userId, link.modelId],
    queryFn: async () => ({ pending: await readPendingSinopiaDelivery(recordFiles, projectId, link) }),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  if (query.data) {
    return (
      <SendForm
        key={query.data.pending?.deliveryId ?? 'new'}
        link={link}
        onOpenChange={onOpenChange}
        pending={query.data.pending}
      />
    );
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sinopiaSend.title')}</DialogTitle>
          <DialogDescription>{t('sinopiaSend.description')}</DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <>
            <p role='alert'>{t('sinopiaSend.errors.failed')}</p>
            <Button
              onClick={() => {
                void query.refetch();
              }}
            >
              {t('common.retry')}
            </Button>
          </>
        ) : (
          <p role='status' aria-busy>
            {t('sinopiaSend.loading')}
          </p>
        )}
        <Button
          variant='outline'
          onClick={() => {
            onOpenChange(false);
          }}
        >
          {t('common.close')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function SendForm({
  link,
  onOpenChange,
  pending,
}: {
  readonly link: SinopiaCadLink;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: PendingSinopiaDelivery | undefined;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { projectId: localProjectId } = useProject();
  const { recordFiles } = useFileManager();
  const { prepareSinopia, deliveryPieces, deliveryAvailable } = useProjectExport();
  const formats = deliveryAvailable ? deliveryFormats : baseFormats;
  const [destinationId, setDestinationId] = useState(pending?.projectId ?? link.projectId);
  const [isChanging, setIsChanging] = useState(false);
  const [selected, setSelected] = useState<SinopiaSendFormat[]>(pending?.selected ?? formats);
  // The model's own preview stands in for the photo when the photo is not sent (E3a: every version has a thumbnail).
  const remoteModel = useQuery({
    queryKey: ['sinopia-send-model', link.userId, link.modelId],
    queryFn: async () => (await getSinopiaCadModel(link)) ?? null,
    retry: false,
    staleTime: 0,
  });
  const [note, setNote] = useState(pending?.note ?? '');
  const [hasPending, setHasPending] = useState(pending !== undefined);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<SinopiaSendError>();
  const [prepared, setPrepared] = useState<SinopiaSendFiles>();
  const [receipt, setReceipt] = useState<SinopiaSendReceipt>();
  const deliveryId = useRef(pending?.deliveryId ?? randomUuid());
  const dialogLifetime = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    dialogLifetime.current = controller;
    // oxlint-disable-next-line react/set-state-in-effect -- Release an obsolete render's delivery gesture when its source changes.
    setIsSending(false);
    return () => {
      controller.abort();
    };
  }, [prepareSinopia]);
  const projects = useQuery({
    queryKey: ['sinopia-send-projects', link.userId],
    queryFn: async ({ signal }) => sinopiaSender.projects(link.userId, signal),
    retry: false,
    staleTime: 0,
  });
  const version = useQuery({
    queryKey: ['sinopia-send-version', link.userId, link.modelId, destinationId],
    queryFn: async ({ signal }) => sinopiaSender.nextVersion(link, destinationId, signal),
    retry: false,
    staleTime: 0,
  });
  const destination = projects.data?.find((project) => project.id === destinationId);
  const isFrozen = isSending || receipt !== undefined || hasPending;
  const problem = error ?? ((projects.error ?? version.error) ? new SinopiaSendError('failed') : undefined);

  const submit = async (): Promise<void> => {
    const signal = dialogLifetime.current?.signal;
    if (!signal || isAborted(signal) || isSending || (!destination && !hasPending && !receipt)) {
      return;
    }
    setIsSending(true);
    setError(undefined);
    try {
      let sent = receipt;
      if (!sent && hasPending) {
        sent = await sinopiaSender.receipt({ link, projectId: destinationId, assetId: deliveryId.current, signal });
        signal.throwIfAborted();
        if (sent) {
          setReceipt(sent);
        }
      }
      if (!sent) {
        const files = await prepareSinopia(signal, version.data === undefined ? undefined : `v${String(version.data)}`);
        signal.throwIfAborted();
        setPrepared(files);
        if (!hasPending) {
          selectedSinopiaFiles(files, selected);
          await writePendingSinopiaDelivery(recordFiles, localProjectId, {
            deliveryId: deliveryId.current,
            modelId: link.modelId,
            userId: link.userId,
            projectId: destinationId,
            selected,
            note,
          });
          signal.throwIfAborted();
          setHasPending(true);
        }
        sent = await sinopiaSender.send({
          link,
          projectId: destinationId,
          selected,
          prepared: files,
          note,
          signal,
          deliveryId: deliveryId.current,
          pieces: deliveryPieces.map((piece) => ({
            nome: piece.nome,
            ...(piece.materiale ? { materiale: { chiave: piece.materiale.chiave, nome: piece.materiale.nome } } : {}),
            ...(piece.processo ? { processo: piece.processo } : {}),
            ...(piece.pesoGrammi === undefined ? {} : { pesoGrammi: piece.pesoGrammi }),
            ...(piece.volumeMm3 === undefined ? {} : { volumeMm3: piece.volumeMm3 }),
          })),
          ...(remoteModel.data?.thumbnail_path ? { fallbackThumbnailPath: remoteModel.data.thumbnail_path } : {}),
        });
        signal.throwIfAborted();
        setReceipt(sent);
      }
      const session = await getSinopiaDataClient();
      signal.throwIfAborted();
      if (session.userId !== sent.userId) {
        throw new SinopiaSendError('session');
      }
      try {
        await recordSinopiaDelivery(recordFiles, localProjectId, sent);
        await recordFiles.unlink(sinopiaPendingPath(localProjectId, deliveryId.current));
      } catch {
        throw new SinopiaSendError('history');
      }
      signal.throwIfAborted();
      const current = await getSinopiaDataClient();
      signal.throwIfAborted();
      if (current.userId !== sent.userId) {
        throw new SinopiaSendError('session');
      }
      const sentProjectId = sent.projectId;
      toast.success(t('sinopiaSend.sent', { number: sent.versionNumber }), {
        action: {
          label: t('sinopiaSend.openProject'),
          onClick: () => {
            globalThis.open(`https://sinopialab.com/project/${sentProjectId}`, '_blank', 'noopener,noreferrer');
          },
        },
      });
      onOpenChange(false);
    } catch (error) {
      if (!isAborted(signal)) {
        const failure = error instanceof SinopiaSendError ? error : new SinopiaSendError('failed');
        if (failure.problem === 'migration' || failure.problem === 'destination' || failure.problem === 'files') {
          try {
            await recordFiles.unlink(sinopiaPendingPath(localProjectId, deliveryId.current));
            setHasPending(false);
          } catch {
            // Keeping an uncertain intent forces reconciliation rather than creating a second delivery.
          }
        }
        setError(failure);
      }
    } finally {
      if (!isAborted(signal)) {
        setIsSending(false);
      }
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!isSending) {
          onOpenChange(next);
        }
      }}
    >
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-130 [&>button:last-child]:hidden'>
        <DialogHeader>
          <DialogTitle>{t('sinopiaSend.title')}</DialogTitle>
          <DialogDescription>{t('sinopiaSend.description')}</DialogDescription>
        </DialogHeader>
        {hasPending && !receipt ? <p className='text-sm'>{t('sinopiaSend.pending')}</p> : null}
        {projects.isPending ? (
          <p role='status' aria-busy>
            {t('sinopiaSend.loading')}
          </p>
        ) : null}
        {destination ? (
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='min-w-0 break-words'>{t('sinopiaSend.destination', { name: destination.name })}</span>
            <Button
              variant='link'
              size='sm'
              disabled={isFrozen}
              onClick={() => {
                setIsChanging((value) => !value);
              }}
            >
              {t('sinopiaSend.change')}
            </Button>
          </div>
        ) : null}
        {isChanging || (!destination && projects.data?.length) ? (
          <label className='grid gap-2 text-sm'>
            {t('sinopiaSend.chooseProject')}
            <select
              value={destinationId}
              disabled={isFrozen}
              className='min-w-0 rounded-md border bg-background p-2'
              onChange={(event) => {
                setDestinationId(event.target.value);
                setIsChanging(false);
                setError(undefined);
                setPrepared(undefined);
              }}
            >
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {projects.data && !destination ? (
          <p role='alert' className='text-sm'>
            {t('sinopiaSend.empty')}
          </p>
        ) : null}
        <div className='space-y-4 py-2'>
          {formats.map((format) => {
            const result = prepared?.[format];
            return (
              <div key={format} className='space-y-2'>
                <label className='flex min-h-8 items-center gap-3 text-sm'>
                  <Checkbox
                    checked={selected.includes(format)}
                    disabled={isFrozen}
                    onCheckedChange={(checked) => {
                      setSelected((previous) =>
                        checked === true ? [...previous, format] : previous.filter((value) => value !== format),
                      );
                      setError(undefined);
                    }}
                  />
                  {t(`sinopiaSend.${format}`)}
                </label>
                {result?.status === 'needsFix' && selected.includes(format) ? (
                  <p role='alert' className='pl-7 text-sm text-muted-foreground'>
                    {t(`export.errors.${result.problem}` as PlainMessageKey)}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <label className='grid gap-2 text-sm'>
          {t('sinopiaSend.note')}
          <Input
            value={note}
            maxLength={2000}
            disabled={isFrozen}
            placeholder={t('sinopiaSend.notePlaceholder')}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
        {version.data === undefined ? null : (
          <p className='rounded-md bg-muted p-3 text-sm text-muted-foreground'>
            {t('sinopiaSend.notice', { number: receipt?.versionNumber ?? version.data })}
          </p>
        )}
        {problem ? (
          <p role='alert' className='text-sm'>
            {problem.problem === 'history' ? t('sinopiaSend.historyError') : t(`sinopiaSend.errors.${problem.problem}`)}
          </p>
        ) : null}
        {isSending ? (
          <p role='status' aria-busy className='text-sm'>
            {t('sinopiaSend.sending')}
          </p>
        ) : null}
        <div className='flex flex-wrap justify-end gap-2 border-t pt-4'>
          <Button
            variant='outline'
            disabled={isSending}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('sinopiaSend.cancel')}
          </Button>
          <Button
            disabled={
              isSending ||
              ((!destination || version.data === undefined) && !hasPending && !receipt) ||
              selected.length === 0
            }
            aria-busy={isSending}
            onClick={() => {
              void submit();
            }}
          >
            {receipt
              ? t('sinopiaSend.retryHistory')
              : hasPending
                ? t('sinopiaSend.resume')
                : t('sinopiaSend.send', { number: version.data ?? 1 })}
          </Button>
        </div>
        {projects.isError || version.isError ? (
          <Button
            variant='ghost'
            onClick={() => {
              void projects.refetch();
              void version.refetch();
            }}
          >
            {t('common.retry')}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
