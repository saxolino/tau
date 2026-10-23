import { useCallback, useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Button } from '@taucad/ui/components/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@taucad/ui/components/card';
import { Field, FieldGroup } from '@taucad/ui/components/field';
import { Input } from '@taucad/ui/components/input';
import { Label } from '@taucad/ui/components/label';
import { Spinner } from '#components/ui/spinner.js';
import { SinopiaCadWordmark } from '#components/icons/sinopiacad-wordmark.js';
import { sinopiaSession } from '#lib/sinopia-session.js';

/**
 * SinopiaCAD's sign-in screen: the Sinopia account's email and password, nothing else. Online at
 * `sinopialab.com/cad` a Sinopia session is picked up and this screen is skipped; there is no sign-up or social login
 * here, as accounts are made on Sinopia.
 *
 * @returns The sign-in screen.
 */
export function SinopiaLogin(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const titleId = useId();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const handleSubmit = useCallback(
    async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setIsPending(true);
      setError(undefined);
      const result = await sinopiaSession().signIn(email.trim(), password);
      /* Signed in, the gate swaps this screen for the workspace as the session announces itself. */
      if (!result.ok) {
        setError(result.message);
        setPassword('');
        setIsPending(false);
      }
    },
    [email, password],
  );

  return (
    <main
      lang='it'
      className='flex min-h-svh flex-col items-center justify-center gap-8 bg-background p-6 text-foreground'
    >
      <SinopiaCadWordmark size='lg' />
      <Card className='w-full max-w-sm'>
        <CardHeader>
          <CardTitle className='text-xl font-semibold'>
            <h1 id={titleId}>Accedi con il tuo account Sinopia</h1>
          </CardTitle>
          <CardDescription>Usa la stessa email e la stessa password di sinopialab.com.</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </main>
  );
}
