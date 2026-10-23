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
import type { MessageKey } from '#i18n/translate.js';

/** The Apache License 2.0 text Tau and SinopiaCAD are distributed under. */
export const apacheLicenseUrl = 'https://www.apache.org/licenses/LICENSE-2.0';

/** Tau's upstream source repository, which SinopiaCAD modifies. */
export const tauSourceUrl = 'https://github.com/taucad/tau';

const links = [
  { label: 'shell.about.license', href: apacheLicenseUrl },
  { label: 'shell.about.source', href: tauSourceUrl },
  { label: 'shell.about.privacy', href: sinopiaLegalUrls.privacy },
  { label: 'shell.about.terms', href: sinopiaLegalUrls.terms },
] as const satisfies ReadonlyArray<{ label: MessageKey; href: string }>;

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
