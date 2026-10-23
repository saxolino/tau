import { useCallback, useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Button } from '@taucad/ui/components/button';
import { Field, FieldGroup, FieldSeparator } from '@taucad/ui/components/field';
import { Input } from '@taucad/ui/components/input';
import { Label } from '@taucad/ui/components/label';
import { Spinner } from '#components/ui/spinner.js';
import { SinopiaAuthFrame } from '#components/auth/sinopia/sinopia-auth-frame.js';
import { SinopiaGoogleButton } from '#components/auth/sinopia/sinopia-google-button.js';
import type { SinopiaNotice } from '#lib/sinopia-access.js';
import { sinopiaSession } from '#lib/sinopia-session.js';

/**
 * SinopiaCAD's sign-in screen, with the same ways in as sinopialab.com's: «Continua con Google» first, then the Sinopia
 * account's email and password. There is no sign-up here, as accounts are made on Sinopia; an account Sinopia has not
 * finished admitting is signed out after either way in and the notice says where to complete it.
 *
 * @param properties - Why the last account was signed out, or why the way back from Google failed.
 * @returns The sign-in screen.
 */
export function SinopiaLogin({ notice }: { readonly notice?: SinopiaNotice }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [googleError, setGoogleError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const titleId = useId();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  /* This screen's own Google failure first; otherwise what the session has to say. */
  const banner = googleError === undefined ? notice : { message: googleError };

  const handleSubmit = useCallback(
    async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setIsPending(true);
      setError(undefined);
      setGoogleError(undefined);
      const result = await sinopiaSession().signIn(email.trim(), password);
      /* Signed in, the gate swaps this screen for the access check as the session announces itself. */
      if (!result.ok) {
        setError(result.message);
        setPassword('');
        setIsPending(false);
      }
    },
    [email, password],
  );

  const handleGoogleStart = useCallback((): void => {
    setError(undefined);
    setGoogleError(undefined);
  }, []);

  return (
    <SinopiaAuthFrame
      titleId={titleId}
      title='Accedi con il tuo account Sinopia'
      description='Entra con Google o con email e password, come su sinopialab.com.'
    >
      <div className='flex flex-col gap-6'>
        {banner === undefined ? null : (
          <div role='alert' className='flex flex-col gap-2 rounded-md border border-destructive/30 p-3 text-sm'>
            <p>{banner.message}</p>
            {banner.link === undefined ? null : (
              <a href={banner.link.href} className='font-medium text-foreground underline underline-offset-4'>
                {banner.link.label}
              </a>
            )}
          </div>
        )}
        <SinopiaGoogleButton isDisabled={isPending} onStart={handleGoogleStart} onError={setGoogleError} />
        <FieldSeparator className='m-0 flex items-center text-xs *:data-[slot=field-separator-content]:bg-card'>
          oppure con email e password
        </FieldSeparator>
        <form
          aria-labelledby={titleId}
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <FieldGroup>
            <Field data-invalid={error === undefined ? undefined : true}>
              <Label htmlFor={emailId}>Email</Label>
              <Input
                id={emailId}
                name='email'
                type='email'
                autoComplete='email'
                required
                value={email}
                disabled={isPending}
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={error === undefined ? undefined : errorId}
                onChange={(event) => {
                  setEmail(event.currentTarget.value);
                }}
              />
            </Field>
            <Field data-invalid={error === undefined ? undefined : true}>
              <Label htmlFor={passwordId}>Password</Label>
              <Input
                id={passwordId}
                name='password'
                type='password'
                autoComplete='current-password'
                required
                value={password}
                disabled={isPending}
                aria-invalid={error === undefined ? undefined : true}
                aria-describedby={error === undefined ? undefined : errorId}
                onChange={(event) => {
                  setPassword(event.currentTarget.value);
                }}
              />
            </Field>
            {error === undefined ? null : (
              <p id={errorId} role='alert' className='text-sm text-destructive'>
                {error}
              </p>
            )}
            <Button type='submit' disabled={isPending}>
              {isPending ? <Spinner aria-label='Accesso in corso' /> : null}
              Accedi
            </Button>
          </FieldGroup>
        </form>
      </div>
    </SinopiaAuthFrame>
  );
}
