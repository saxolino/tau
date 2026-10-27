import { Info } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { DropdownMenuItem } from '@taucad/ui/components/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@taucad/ui/components/dialog';
import { SinopiaCadWordmark } from '#components/icons/sinopiacad-wordmark.js';
import { metaConfig } from '#constants/meta.constants.js';
import { sinopiaLegalUrls } from '#lib/legal-url.js';
import { useTranslation } from '#i18n/translate.js';
import type { MessageKey, PlainMessageKey } from '#i18n/translate.js';

/** The Apache License 2.0 text Tau and SinopiaCAD are distributed under. */
export const apacheLicenseUrl = 'https://www.apache.org/licenses/LICENSE-2.0';

/** Tau's upstream source repository, which SinopiaCAD modifies. */
export const tauSourceUrl = 'https://github.com/taucad/tau';

/**
 * Open CASCADE Technology as SinopiaCAD ships it: the `libcascade` 3.1.0 WebAssembly build (its provenance file names
 * the OCCT and binding commits below), LGPL 2.1 with the Open CASCADE exception, which asks for a prominent notice.
 */
export const occtNotice = {
  source: 'https://github.com/Open-Cascade-SAS/OCCT/tree/b8f597c677811d1f9f4d8a97f5ae2825c0353a42',
  module: 'https://github.com/taucad/opencascade.js/tree/341fa789f49ce73db76a0209d89ae518cc64a52d',
  lgpl: 'https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html',
  exception:
    'https://github.com/Open-Cascade-SAS/OCCT/blob/b8f597c677811d1f9f4d8a97f5ae2825c0353a42/OCCT_LGPL_EXCEPTION.txt',
} as const;

const thirdPartyLinks = [
  { label: 'shell.about.thirdParty.occtSource', href: occtNotice.source },
  { label: 'shell.about.thirdParty.occtModule', href: occtNotice.module },
  { label: 'shell.about.thirdParty.lgpl', href: occtNotice.lgpl },
  { label: 'shell.about.thirdParty.occtException', href: occtNotice.exception },
] as const satisfies ReadonlyArray<{ label: PlainMessageKey; href: string }>;

const engineLinks = [
  { label: 'shell.about.thirdParty.smlibSite', href: 'https://smlibpy.classcad.ch/docs/javascript' },
  { label: 'shell.about.thirdParty.pdfLib', href: 'https://github.com/Hopding/pdf-lib' },
] as const satisfies ReadonlyArray<{ label: PlainMessageKey; href: string }>;

const links = [
  { label: 'shell.about.license', href: apacheLicenseUrl },
  { label: 'shell.about.source', href: tauSourceUrl },
  { label: 'shell.about.privacy', href: sinopiaLegalUrls.privacy },
  { label: 'shell.about.terms', href: sinopiaLegalUrls.terms },
] as const satisfies ReadonlyArray<{ label: MessageKey; href: string }>;

/** A compact list of external links, opened in a new tab. */
function LinkList({
  links: items,
}: {
  readonly links: ReadonlyArray<{ label: PlainMessageKey; href: string }>;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ul className='flex flex-wrap gap-x-3 gap-y-1 text-xs'>
      {items.map((link) => (
        <li key={link.href}>
          <a href={link.href} target='_blank' rel='noopener noreferrer' className='underline'>
            {t(link.label)}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Help-menu entry that opens the credits dialog. */
export function AboutMenuItem({ onSelect }: { readonly onSelect: () => void }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <Info />
      {t('shell.about.title')}
    </DropdownMenuItem>
  );
}

/**
 * Credits and licence for SinopiaCAD: a modified version of Tau (Apache-2.0) made by Sinopia.
 * Opened from Help → Informazioni.
 */
export function AboutDialog({
  isOpen,
  onOpenChange,
}: {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md [&>button[data-slot=dialog-close]]:hidden'>
        <DialogHeader>
          <SinopiaCadWordmark size='lg' className='mb-2' />
          <DialogTitle>{t('shell.about.title')}</DialogTitle>
          <DialogDescription>{t('shell.about.description')}</DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3 text-sm'>
          <p>{t('shell.about.body')}</p>
          <ul className='flex flex-col gap-1'>
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href} target='_blank' rel='noopener noreferrer' className='underline'>
                  {t(link.label)}
                </a>
              </li>
            ))}
          </ul>
          <section aria-labelledby='about-third-party' className='flex flex-col gap-2 border-t pt-3'>
            <h3 id='about-third-party' className='text-xs font-semibold'>
              {t('shell.about.thirdParty.title')}
            </h3>
            <p className='text-xs text-muted-foreground'>{t('shell.about.thirdParty.occt')}</p>
            <LinkList links={thirdPartyLinks} />
            <p className='text-xs text-muted-foreground'>{t('shell.about.thirdParty.smlib')}</p>
            <LinkList links={engineLinks} />
          </section>
          <p className='text-muted-foreground tabular-nums'>
            {t('shell.about.version', { version: metaConfig.version })}
          </p>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('shell.about.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
