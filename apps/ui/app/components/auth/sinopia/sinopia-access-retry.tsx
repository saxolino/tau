import { useId } from 'react';
import { Button } from '@taucad/ui/components/button';
import { SinopiaAuthFrame } from '#components/auth/sinopia/sinopia-auth-frame.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import type { SinopiaUser } from '#lib/sinopia-session.js';

/**
 * SinopiaCAD: the access check could not be read (Sinopia did not answer). As on sinopialab.com, a failure of ours
 * neither opens the workspace nor turns the account away: the person tries again, or leaves.
 *
 * @param properties - The signed-in account.
 * @returns The screen.
 */
export function SinopiaAccessRetry({ user }: { readonly user: SinopiaUser }): React.JSX.Element {
  const titleId = useId();

  return (
    <SinopiaAuthFrame
      titleId={titleId}
      title='Non riesco a verificare l’accesso'
      description={`Sinopia non ha risposto mentre controllavo l’account ${user.email ?? 'Sinopia'}. Controlla la connessione e riprova.`}
    >
      <div className='flex flex-col gap-3'>
        <Button
          type='button'
          onClick={() => {
            sinopiaSession().retryAccess();
          }}
        >
          Riprova
        </Button>
        <Button
          type='button'
          variant='ghost'
          onClick={() => {
            // async-iife: bootstrap -- signing out announces itself; the gate then shows the sign-in screen.
            void (async (): Promise<void> => {
              try {
                await sinopiaSession().signOut();
              } catch (error) {
                console.error('[sinopia] sign-out failed', error);
              }
            })();
          }}
        >
          Esci
        </Button>
      </div>
    </SinopiaAuthFrame>
  );
}
