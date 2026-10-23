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

/** The Apache License 2.0 text Tau and SinopiaCAD are distributed under. */
export const apacheLicenseUrl = 'https://www.apache.org/licenses/LICENSE-2.0';

/** Tau's upstream source repository, which SinopiaCAD modifies. */
export const tauSourceUrl = 'https://github.com/taucad/tau';

const links = [
  { label: 'Licenza Apache-2.0', href: apacheLicenseUrl },
  { label: 'Codice sorgente di Tau', href: tauSourceUrl },
  { label: 'Informativa privacy', href: sinopiaLegalUrls.privacy },
  { label: 'Condizioni d’uso', href: sinopiaLegalUrls.terms },
] as const;

/** Help-menu entry that opens the credits dialog. */
export function AboutMenuItem({ onSelect }: { readonly onSelect: () => void }): React.JSX.Element {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <Info />
      Informazioni
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
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <SinopiaCadWordmark size='lg' className='mb-2' />
          <DialogTitle>Informazioni</DialogTitle>
          <DialogDescription>SinopiaCAD — basato su Tau (taucad/tau), licenza Apache-2.0.</DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-3 text-sm'>
          <p>
            SinopiaCAD è una versione modificata di Tau, realizzata da Sinopia (sinopialab.com). Il codice di Tau resta
            dei suoi autori e conserva la sua licenza; le modifiche di Sinopia sono elencate nel file
            MODIFICHE-SINOPIA.md del codice sorgente.
          </p>
          <ul className='flex flex-col gap-1'>
            {links.map((link) => (
              <li key={link.href}>
                <a href={link.href} target='_blank' rel='noopener noreferrer' className='underline'>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <p className='text-muted-foreground tabular-nums'>Versione {metaConfig.version}</p>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
