import { useEffect, useRef, useState } from 'react';
import { ArrowUpCircle, Check, ArrowUpRight, ChevronRight, Download, LoaderCircle, ShieldAlert, X } from 'lucide-react';
import type { DesktopUpdateBridge, DesktopUpdateSnapshot } from '@taucad/types/desktop-updates';
import { Button } from '@taucad/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@taucad/ui/components/popover';
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton, useSidebar } from '@taucad/ui/components/sidebar';
import { desktopUpdates } from '#filesystem/desktop-bridge.js';
import { useTranslation } from '#i18n/translate.js';

/** Desktop-only subscription. Main owns checks, downloads and restart admission. */
export function DesktopUpdate(): React.JSX.Element | undefined {
  const bridge = desktopUpdates();
  return bridge ? <DesktopUpdateControl bridge={bridge} /> : undefined;
}

/** Same shipping control used by the design preview with a local bridge fixture. */
export function DesktopUpdateControl({
  bridge,
}: {
  readonly bridge: DesktopUpdateBridge;
}): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<DesktopUpdateSnapshot>();
  const [open, setOpen] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const { setOpen: showSidebar, setOpenMobile, isMobile } = useSidebar();
  const revealedRequest = useRef(0);
  useEffect(() => {
    const subscriptionLifetime = new AbortController();
    const receive = (next: DesktopUpdateSnapshot, reveal: boolean): void => {
      if (!subscriptionLifetime.signal.aborted) {
        if (reveal && next.requestId > revealedRequest.current) {
          showSidebar(true);
          if (isMobile) {
            setOpenMobile(true);
          }
          setOpen(true);
        }
        revealedRequest.current = Math.max(revealedRequest.current, next.requestId);
        setSnapshot((previous) => (previous && previous.revision >= next.revision ? previous : next));
      }
    };
    // Subscribe first; revisions prevent a slower initial read from replacing a newer event.
    const unsubscribe = bridge.subscribe((next) => {
      receive(next, true);
    });
    // async-iife: bootstrap — hydrate the external subscription; cleanup ignores late results.
    void (async () => {
      try {
        // Hydration restores status, not a historical request to open the popover.
        receive(await bridge.snapshot(), false);
      } catch {
        if (!subscriptionLifetime.signal.aborted) {
          setActionFailed(true);
        }
      }
    })();
    return () => {
      subscriptionLifetime.abort();
      unsubscribe();
    };
  }, [bridge, showSidebar, setOpenMobile, isMobile]);
  if (!snapshot) {
    return undefined;
  }
  const { phase } = snapshot;
  const phaseKey =
    phase === 'system-managed' ? 'systemManaged' : phase === 'restart-blocked' ? 'restartBlocked' : phase;
  const busy = phase === 'saving' || phase === 'restarting' || phase === 'checking';
  const failed = phase === 'error' || phase === 'restart-blocked' || actionFailed;
  const quiet = phase === 'current' || phase === 'checking' || phase === 'disabled' || phase === 'system-managed';
  if (quiet && !open) {
    return undefined;
  }
  const title = actionFailed ? t('shell.update.failedTitle') : t(`shell.update.title.${phaseKey}`);
  const detail = actionFailed
    ? t('shell.update.failedDetail')
    : (snapshot.detail ??
      (phase === 'ready' && snapshot.installOnQuit === false
        ? t('shell.update.detail.readyLater')
        : t(`shell.update.detail.${phaseKey}`)));
  const Icon = failed
    ? ShieldAlert
    : busy || phase === 'downloading'
      ? LoaderCircle
      : phase === 'current'
        ? Check
        : phase === 'available'
          ? Download
          : ArrowUpCircle;
  const act = async (): Promise<void> => {
    setActionFailed(false);
    try {
      if (phase === 'ready' || phase === 'restart-blocked') {
        await bridge.install();
      } else if (phase === 'available') {
        await bridge.download();
      } else {
        await bridge.check();
      }
    } catch {
      setActionFailed(true);
    }
  };
  return (
    <SidebarMenu className='p-1'>
      <SidebarMenuItem>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <SidebarMenuButton className='data-[state=open]:bg-sidebar-accent' aria-label={title}>
              <Icon className={failed ? 'text-destructive' : 'text-muted-foreground'} />
              <span>{title}</span>
              <ChevronRight className='ml-auto text-muted-foreground' />
            </SidebarMenuButton>
          </PopoverTrigger>
          <PopoverContent
            side='top'
            align='start'
            sideOffset={4}
            collisionPadding={8}
            className='w-64 max-w-[calc(100vw-1rem)] p-3'
            aria-label={t('shell.update.panelLabel')}
          >
            <div className='flex items-center justify-between gap-2'>
              <h2 className='text-sm leading-5 font-medium'>{title}</h2>
              <Button
                variant='ghost'
                size='icon-xs'
                aria-label={t('shell.update.closeDetails')}
                onClick={() => {
                  setOpen(false);
                }}
              >
                <X />
              </Button>
            </div>
            <p className='text-xs leading-4 text-muted-foreground'>
              {t('shell.update.version', { version: snapshot.version ?? snapshot.currentVersion })}
              {snapshot.channel === 'staging' ? t('shell.update.staging') : ''}
            </p>
            <p className='mt-2 text-xs leading-4 text-muted-foreground'>{detail}</p>
            <div className='mt-3 flex items-center justify-between gap-2'>
              {snapshot.releasePage ? (
                <Button asChild variant='ghost' size='xs' className='-ml-2'>
                  <a href={snapshot.releasePage} target='_blank' rel='noopener noreferrer'>
                    {t('shell.update.whatsNew')}
                    <ArrowUpRight className='size-3' />
                  </a>
                </Button>
              ) : (
                <span />
              )}
              {phase !== 'downloading' && phase !== 'disabled' ? (
                <Button
                  size='xs'
                  variant={
                    phase === 'error' || phase === 'current' || phase === 'system-managed' ? 'outline' : 'default'
                  }
                  disabled={busy}
                  onClick={() => {
                    void act();
                  }}
                >
                  {busy ? <LoaderCircle className='size-3 spin-glyph' /> : undefined}
                  {busy
                    ? t('shell.update.wait')
                    : phase === 'ready'
                      ? t('shell.update.restartNow')
                      : phase === 'restart-blocked'
                        ? t('shell.update.retryRestart')
                        : phase === 'available'
                          ? t('shell.update.download')
                          : phase === 'current' || phase === 'system-managed'
                            ? t('shell.update.checkAgain')
                            : t('shell.update.retry')}
                </Button>
              ) : undefined}
            </div>
          </PopoverContent>
        </Popover>
        <span className='sr-only' role='status' aria-live='polite'>
          {title}
        </span>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
