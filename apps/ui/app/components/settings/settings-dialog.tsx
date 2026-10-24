import { GithubRepositorySettings } from '#components/settings/github-repository-settings.js';
import { BrowserSettingsPanel } from '#components/browser/browser-settings.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefCallback } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { AccountSettings } from '#components/auth/settings/account/account-settings.js';
import { SecuritySettings } from '#components/auth/settings/security/security-settings.js';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@taucad/ui/components/dialog';
import { useSettingsDialog } from '#hooks/use-settings-dialog.js';
import type { SettingsSection } from '#hooks/use-settings-dialog.js';
import { CloudBillingSettings } from '#cloud/settings-billing.js';
import { FileSystemSettings } from '#components/settings/filesystem-settings.js';
import {
  SinopiaAppearanceSettings,
  SinopiaModelSettings,
  SinopiaToolsSettings,
} from '#components/settings/sinopia-settings.js';
import { useTranslation } from '#i18n/translate.js';
import { ExperimentalSettings } from '#components/settings/experimental-settings.js';
import { AgentSettings } from '#components/settings/agent-settings.js';
import { SettingsAuthGate } from '#components/settings/settings-auth-gate.js';
import { RemoteComputeSettings } from '#components/settings/remote-compute-settings.js';
import { ComputeReuseSettings } from '#components/settings/compute-reuse-settings.js';
import { MachinesSettings } from '#components/settings/machines-settings.js';
import { useKeybinding } from '@taucad/ui/components/keyboard';

import { Button } from '@taucad/ui/components/button';
import { Input } from '@taucad/ui/components/input';
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '#components/ui/sidebar.js';
import { getSettingsSections, searchSettings } from '#components/settings/settings-registry.js';
import { SettingsItem } from '#components/settings/settings-item.js';

/** Keep authenticated sections behind their existing gate and mount only the active section. */
function SettingsContent({ section }: { readonly section: SettingsSection }): React.JSX.Element {
  switch (section) {
    case 'browser': {
      return (
        <SettingsItem settingId='web-browser'>
          <BrowserSettingsPanel />
        </SettingsItem>
      );
    }
    case 'general': {
      return <SinopiaAppearanceSettings />;
    }
    case 'account': {
      return (
        <SettingsAuthGate>
          <SettingsItem settingId='profile'>
            <AccountSettings />
          </SettingsItem>
        </SettingsAuthGate>
      );
    }
    case 'security': {
      return (
        <SettingsAuthGate>
          <SecuritySettings />
        </SettingsAuthGate>
      );
    }
    case 'repositories': {
      return (
        <SettingsAuthGate>
          <GithubRepositorySettings />
        </SettingsAuthGate>
      );
    }
    case 'billing': {
      return (
        <SettingsAuthGate>
          <CloudBillingSettings />
        </SettingsAuthGate>
      );
    }
    case 'compute': {
      return (
        <>
          <SettingsItem settingId='compute-reuse'>
            <ComputeReuseSettings />
          </SettingsItem>
          <SettingsAuthGate>
            <SettingsItem settingId='tau-host'>
              <RemoteComputeSettings />
            </SettingsItem>
          </SettingsAuthGate>
        </>
      );
    }
    case 'machines': {
      return (
        <SettingsItem settingId='machines'>
          <MachinesSettings />
        </SettingsItem>
      );
    }
    case 'models': {
      return <SinopiaModelSettings />;
    }
    case 'tools': {
      return <SinopiaToolsSettings />;
    }
    case 'agents': {
      return <AgentSettings />;
    }
    case 'filesystem': {
      return <FileSystemSettings />;
    }
    case 'experimental': {
      return <ExperimentalSettings />;
    }
  }
}

/** URL-backed settings navigation with a searchable catalogue of individual controls. */
export function SettingsDialog(): React.JSX.Element {
  const { t } = useTranslation();
  const settingsSections = getSettingsSections(t);
  const { isOpen, section: activeSection, open, close } = useSettingsDialog();
  useKeybinding({ key: ',', modKey: true }, () => {
    open();
  });
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        close();
      }
    },
    [close],
  );
  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {isOpen ? (
        <SettingsSurface
          activeSection={settingsSections.some(({ id }) => id === activeSection) ? activeSection : 'general'}
        />
      ) : null}
    </Dialog>
  );
}

function SettingsSurface({ activeSection }: { readonly activeSection: SettingsSection }): React.JSX.Element {
  const { t } = useTranslation();
  const settingsSections = getSettingsSections(t);
  const { open: openSection, close, target: linkedSetting } = useSettingsDialog();
  const [query, setQuery] = useState('');
  const [searchDestination, setDestination] = useState<{ section: SettingsSection; id?: string }>();
  const searchRef = useRef<HTMLInputElement>(null);
  // State, not a ref: the dialog mounts its content after the first effects run, and a
  // deep link opening the dialog has to wait for it.
  const [content, setContent] = useState<HTMLDivElement>();
  const contentRef = useCallback<RefCallback<HTMLDivElement>>((element) => {
    setContent(element ?? undefined);
  }, []);
  const results = searchSettings(query, settingsSections);
  const isSearching = query.trim().length > 0;
  const active = settingsSections.find((section) => section.id === activeSection)!;
  const resultCount = results.reduce((total, group) => total + group.entries.length, 0);

  // A deep link from outside the dialog (`?setting=`) reveals its control like a search result does.
  // Navigating inside the dialog drops the parameter, so a present link is always the latest request.
  const linkedDestination = useMemo(
    () => (linkedSetting ? { section: activeSection, id: linkedSetting } : undefined),
    [activeSection, linkedSetting],
  );
  const destination = linkedDestination ?? searchDestination;

  useEffect(() => {
    if (!destination || destination.section !== activeSection) {
      return;
    }
    if (!content) {
      return;
    }
    let frame: number;
    const reveal = (): boolean => {
      const target = destination.id
        ? content.querySelector<HTMLElement>(`#settings-${CSS.escape(destination.id)}`)
        : undefined;
      if (!target) {
        return false;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center' });
      return true;
    };
    // Billing and filesystem destinations may arrive after their data finishes loading.
    const observer = new MutationObserver(() => {
      if (document.activeElement !== content) {
        observer.disconnect();
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.activeElement === content && reveal()) {
          observer.disconnect();
        }
      });
    });
    frame = requestAnimationFrame(() => {
      if (!reveal()) {
        content.focus({ preventScroll: true });
        content.scrollTo({ top: 0 });
        if (destination.id) {
          observer.observe(content, { childList: true, subtree: true });
        }
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [activeSection, content, destination]);

  const navigate = (section: SettingsSection, id?: string): void => {
    openSection(section);
    setDestination({ section, id });
  };
  const clearSearch = (): void => {
    setQuery('');
    searchRef.current?.focus();
  };

  return (
    <DialogContent
      className='h-[90dvh] max-w-[calc(100%-2rem)] grid-rows-[1fr] gap-0 overflow-hidden p-0 sm:max-w-6xl [&_[data-slot=input-group]]:bg-card [&_[data-slot=input]]:bg-card [&_[data-slot=select-trigger]]:bg-card [&_[data-slot=slider-input]]:bg-card [&_[data-slot=textarea]]:bg-card [&>button[data-slot=dialog-close]]:hidden'
      onOpenAutoFocus={(event) => {
        // A deep link owns focus: its reveal moves it to the content, not the dialog's first button.
        if (linkedDestination) {
          event.preventDefault();
        }
      }}
      onEscapeKeyDown={(event) => {
        if (query) {
          event.preventDefault();
          clearSearch();
        }
      }}
    >
      <div className='absolute top-4 right-4 z-10'>
        <DialogClose asChild>
          <Button variant='ghost' size='icon-sm' aria-label={t('common.close')}>
            <X />
          </Button>
        </DialogClose>
      </div>
      <DialogTitle className='sr-only'>{t('account.settings.title')}</DialogTitle>
      <DialogDescription className='sr-only'>{t('account.settings.description')}</DialogDescription>
      <div className='flex min-h-0 min-w-0 flex-col md:flex-row'>
        <aside className='flex shrink-0 flex-col gap-4 border-b bg-sidebar p-4 max-md:max-h-[45%] md:w-64 md:border-r md:border-b-0'>
          <Button variant='ghost' className='w-full justify-start' onClick={close}>
            <ArrowLeft className='size-4' aria-hidden='true' /> {t('account.settings.back')}
          </Button>
          <form
            className='relative'
            role='search'
            aria-label={t('account.settings.search')}
            onSubmit={(event) => {
              event.preventDefault();
              const first = results[0];
              if (first?.entries[0]) {
                navigate(first.section.id, first.entries[0].id);
              }
            }}
          >
            <Input
              type='search'
              className='pr-8 [&::-webkit-search-cancel-button]:appearance-none'
              ref={searchRef}
              aria-label={t('account.settings.search')}
              placeholder={t('account.settings.searchPlaceholder')}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            {query ? (
              <Button
                type='button'
                variant='ghost'
                size='icon-xs'
                className='absolute top-1/2 right-1 -translate-y-1/2'
                aria-label={t('account.settings.clear')}
                onClick={clearSearch}
              >
                <X />
              </Button>
            ) : null}
          </form>
          <nav aria-label={t('account.settings.navigation')} className='min-h-0 overflow-y-auto'>
            {isSearching ? (
              <div className='space-y-4'>
                <p role='status' className='px-2 text-xs text-muted-foreground'>
                  {resultCount === 0
                    ? t('account.settings.empty')
                    : t('account.settings.found', { count: resultCount })}
                </p>
                {resultCount === 0 ? (
                  <p className='px-2 text-sm text-muted-foreground'>{t('account.settings.hint')}</p>
                ) : null}
                {results.map(({ section, entries }) => (
                  <SidebarGroup key={section.id} role='group' aria-label={section.label} className='px-0'>
                    <SidebarMenu>
                      <SidebarMenuItem>
                        <SidebarMenuButton
                          className='text-muted-foreground'
                          onClick={() => {
                            navigate(section.id);
                          }}
                        >
                          <section.icon className='size-4 shrink-0' aria-hidden='true' />
                          <span>{section.label}</span>
                        </SidebarMenuButton>
                        <SidebarMenuSub>
                          {entries.map((entry) => (
                            <SidebarMenuSubItem key={entry.id}>
                              <SidebarMenuSubButton
                                asChild
                                title={entry.description}
                                isActive={destination?.section === activeSection && destination.id === entry.id}
                              >
                                <button
                                  type='button'
                                  onClick={() => {
                                    navigate(section.id, entry.id);
                                  }}
                                >
                                  <span>{entry.label}</span>
                                </button>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </SidebarGroup>
                ))}
              </div>
            ) : (
              <div className='flex md:flex-col'>
                {[...new Set(settingsSections.map((section) => section.group))].map((group) => (
                  <SidebarGroup key={group} className='shrink-0 px-0'>
                    <SidebarGroupLabel className='max-md:hidden'>{group}</SidebarGroupLabel>
                    <SidebarMenu>
                      {settingsSections
                        .filter((section) => section.group === group)
                        .map((section) => (
                          <SidebarMenuItem key={section.id}>
                            <SidebarMenuButton
                              isActive={activeSection === section.id}
                              onClick={() => {
                                navigate(section.id);
                              }}
                            >
                              <section.icon className='size-4' aria-hidden='true' />
                              <span>{section.label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                  </SidebarGroup>
                ))}
              </div>
            )}
          </nav>
        </aside>
        <div
          ref={contentRef}
          role='region'
          aria-label={active.label}
          tabIndex={-1}
          className='min-h-0 min-w-0 flex-1 overflow-y-auto bg-muted/40 p-6 focus-visible:focus-outline md:p-10'
        >
          <div className='mx-auto flex max-w-3xl flex-col gap-6 [&_[data-settings-section]]:gap-3 [&_[data-settings-section]]:border-0 [&_[data-settings-section]]:bg-transparent [&_[data-settings-section]]:py-0 [&_[data-settings-section]>[data-slot=card-content]]:rounded-xl [&_[data-settings-section]>[data-slot=card-content]]:border [&_[data-settings-section]>[data-slot=card-content]]:bg-card [&_[data-settings-section]>[data-slot=card-content]]:py-4 [&_[data-settings-section]>[data-slot=card-content]:has(>[data-slot=settings-item])]:gap-0 [&_[data-settings-section]>[data-slot=card-content]>[data-slot=settings-item]:not(:first-child)]:pt-4 [&_[data-settings-section]>[data-slot=card-content]>[data-slot=settings-item]:not(:first-child)]:before:absolute [&_[data-settings-section]>[data-slot=card-content]>[data-slot=settings-item]:not(:first-child)]:before:inset-x-0 [&_[data-settings-section]>[data-slot=card-content]>[data-slot=settings-item]:not(:first-child)]:before:top-0 [&_[data-settings-section]>[data-slot=card-content]>[data-slot=settings-item]:not(:first-child)]:before:border-t [&_[data-settings-section]>[data-slot=card-content]>[data-slot=settings-item]:not(:first-child)]:before:content-[""] [&_[data-settings-section]>[data-slot=card-content]>[data-slot=settings-item]:not(:last-child)]:pb-4 [&_[data-settings-section]>[data-slot=card-header]]:px-0 [&_[data-settings-section]>[data-slot=card-header]_[data-slot=card-description]]:hidden [&_[data-settings-section]>[data-slot=card-header]_[data-slot=card-title]]:text-sm [&_[data-settings-section]>[data-slot=card-header]_[data-slot=card-title]]:font-medium [&_[data-slot=card]]:shadow-none [&_h2]:text-sm [&_h2]:font-medium'>
            <h2 className='text-lg font-medium'>{active.label}</h2>
            <SettingsContent section={activeSection} />
          </div>
        </div>
      </div>
    </DialogContent>
  );
}
