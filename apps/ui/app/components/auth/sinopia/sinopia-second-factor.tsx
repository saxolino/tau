import { useCallback, useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Button } from '@taucad/ui/components/button';
import { Field, FieldGroup } from '@taucad/ui/components/field';
import { Input } from '@taucad/ui/components/input';
import { Label } from '@taucad/ui/components/label';
import { Spinner } from '#components/ui/spinner.js';
import { SinopiaAuthFrame } from '#components/auth/sinopia/sinopia-auth-frame.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import type { SinopiaUser } from '#lib/sinopia-session.js';

const codeLength = 6;

/** Keep the digits only, at most six, as Sinopia's `normaliseTotpCode` does. */
const normaliseCode = (input: string): string => input.replaceAll(/\D/g, '').slice(0, codeLength);

/**
 * SinopiaCAD's second-factor step, as sinopialab.com's `MfaChallengeGate`: an account with an authenticator confirms
 * this session with the app's current code before anything of Sinopia's is read for it. «Esci» leaves instead.
 *
 * @param properties - The signed-in account.
 * @returns The second-factor screen.
 */
export function SinopiaSecondFactor({ user }: { readonly user: SinopiaUser }): React.JSX.Element {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const titleId = useId();
  const codeId = useId();
  const errorId = useId();

  const handleSubmit = useCallback(
    async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setIsPending(true);
      setError(undefined);
      const result = await sinopiaSession().verifySecondFactor(code);
      /* Confirmed, the gate swaps this screen for the access check as the session announces itself. */
      if (!result.ok) {
        setError(result.message);
        setCode('');
        setIsPending(false);
      }
    },
    [code],
  );

  return (
    <SinopiaAuthFrame
      titleId={titleId}
      title='Conferma la tua identità'
      description={`L’account ${user.email ?? 'Sinopia'} è protetto da un secondo fattore. Inserisci il codice dell’app di autenticazione per continuare.`}
    >
      <form
        aria-labelledby={titleId}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <FieldGroup>
          <Field data-invalid={error === undefined ? undefined : true}>
            <Label htmlFor={codeId}>Codice di verifica</Label>
            <Input
              id={codeId}
              name='code'
              inputMode='numeric'
              autoComplete='one-time-code'
              placeholder='Codice a 6 cifre'
              className='text-center font-mono tabular-nums'
              value={code}
              disabled={isPending}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={error === undefined ? undefined : errorId}
              onChange={(event) => {
                setCode(normaliseCode(event.currentTarget.value));
              }}
            />
          </Field>
          {error === undefined ? null : (
            <p id={errorId} role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          )}
          <Button type='submit' disabled={isPending || code.length !== codeLength}>
            {isPending ? <Spinner aria-label='Verifica in corso' /> : null}
            Continua
          </Button>
          <Button
            type='button'
            variant='ghost'
            disabled={isPending}
            onClick={() => {
              // async-iife: bootstrap -- signing out announces itself; the gate then shows the sign-in screen.
              void (async (): Promise<void> => {
                try {
                  await sinopiaSession().signOut();
                } catch (signOutError) {
                  console.error('[sinopia] sign-out failed', signOutError);
                }
              })();
            }}
          >
            Esci e accedi con un altro account
          </Button>
        </FieldGroup>
      </form>
    </SinopiaAuthFrame>
  );
}
