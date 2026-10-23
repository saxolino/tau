import { useCallback, useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Button } from '@taucad/ui/components/button';
import { Field, FieldGroup } from '@taucad/ui/components/field';
import { Input } from '@taucad/ui/components/input';
import { Label } from '@taucad/ui/components/label';
import { Spinner } from '#components/ui/spinner.js';
import { SinopiaAuthFrame } from '#components/auth/sinopia/sinopia-auth-frame.js';
import { useTranslation } from '#i18n/translate.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import type { SinopiaMessageCode } from '#lib/sinopia-access.js';
import type { SinopiaUser } from '#lib/sinopia-session.js';

const codeLength = 6;

/** Keep the digits only, at most six, as Sinopia's `normaliseTotpCode` does. */
const normaliseCode = (input: string): string => input.replaceAll(/\D/g, '').slice(0, codeLength);

/**
 * SinopiaCAD's second-factor step, as sinopialab.com's `MfaChallengeGate`: an account with an authenticator confirms
 * this session with the app's current code before anything of Sinopia's is read for it. The sign-out button leaves instead.
 *
 * @param properties - The signed-in account.
 * @returns The second-factor screen.
 */
export function SinopiaSecondFactor({ user }: { readonly user: SinopiaUser }): React.JSX.Element {
  const [code, setCode] = useState('');
  const { t } = useTranslation();
  const [error, setError] = useState<SinopiaMessageCode | undefined>(undefined);
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
        setError(result.code);
        setCode('');
        setIsPending(false);
      }
    },
    [code],
  );

  return (
    <SinopiaAuthFrame
      titleId={titleId}
      title={t('auth.secondFactor.title')}
      description={t('auth.secondFactor.description', {
        email: user.email ?? t('auth.secondFactor.accountFallback'),
      })}
    >
      <form
        aria-labelledby={titleId}
        aria-busy={isPending}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <FieldGroup>
          <Field data-invalid={error === undefined ? undefined : true}>
            <Label htmlFor={codeId}>{t('auth.secondFactor.codeLabel')}</Label>
            <Input
              id={codeId}
              name='code'
              inputMode='numeric'
              required
              autoComplete='one-time-code'
              placeholder={t('auth.secondFactor.codePlaceholder')}
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
              {t(`auth.messages.${error}`)}
            </p>
          )}
          <Button type='submit' disabled={isPending || code.length !== codeLength}>
            {isPending ? <Spinner aria-hidden /> : null}
            <span role={isPending ? 'status' : undefined}>
              {isPending ? t('auth.secondFactor.pending') : t('auth.secondFactor.submit')}
            </span>
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
            {t('auth.secondFactor.signOut')}
          </Button>
        </FieldGroup>
      </form>
    </SinopiaAuthFrame>
  );
}
