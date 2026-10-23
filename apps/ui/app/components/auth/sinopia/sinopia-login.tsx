import { Fragment, useCallback, useId, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { Button } from '@taucad/ui/components/button';
import { Field, FieldGroup, FieldSeparator } from '@taucad/ui/components/field';
import { Input } from '@taucad/ui/components/input';
import { Label } from '@taucad/ui/components/label';
import { Spinner } from '#components/ui/spinner.js';
import { SinopiaAuthFrame } from '#components/auth/sinopia/sinopia-auth-frame.js';
import { SinopiaGoogleButton } from '#components/auth/sinopia/sinopia-google-button.js';
import type { SinopiaMessageCode, SinopiaNotice } from '#lib/sinopia-access.js';
import { useLanguage, setLanguage, languages } from '#i18n/language.js';
import type { Language } from '#i18n/language.js';
import { useTranslation } from '#i18n/translate.js';
import { sinopiaSession } from '#lib/sinopia-session.js';

const languageNames: Readonly<Record<Language, 'auth.language.italian' | 'auth.language.english'>> = {
  it: 'auth.language.italian',
  en: 'auth.language.english',
};

/**
 * The small «Italiano · English» switch under the sign-in card (UI-UX-SinopiaCAD §6.1): there is no account menu yet,
 * so this is the one place outside it where the language is chosen. Each language is written in its own tongue.
 *
 * @returns The two buttons, the current language marked.
 */
function SinopiaLanguageSwitch(): React.JSX.Element {
  const { t } = useTranslation();
  const current = useLanguage();
  return (
    <div role='group' aria-label={t('auth.language.label')} className='flex items-center gap-1 text-xs'>
      {languages.map((language, index) => (
        <Fragment key={language}>
          {index === 0 ? null : <span aria-hidden>·</span>}
          <Button
            type='button'
            variant='link'
            size='sm'
            className={current === language ? 'font-semibold text-foreground' : 'text-muted-foreground'}
            aria-pressed={current === language}
            lang={language}
            onClick={() => {
              setLanguage(language);
            }}
          >
            {t(languageNames[language])}
          </Button>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * SinopiaCAD's sign-in screen, with the same ways in as sinopialab.com's: «Continua con Google» first, then the Sinopia
 * account's email and password. There is no sign-up here, as accounts are made on Sinopia; an account Sinopia has not
 * finished admitting is signed out after either way in and the notice says where to complete it.
 *
 * @param properties - Why the last account was signed out, or why the way back from Google failed.
 * @returns The sign-in screen.
 */
export function SinopiaLogin({ notice }: { readonly notice?: SinopiaNotice }): React.JSX.Element {
  const [dismissedNotice, setDismissedNotice] = useState<SinopiaNotice>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { t } = useTranslation();
  const [error, setError] = useState<SinopiaMessageCode | undefined>(undefined);
  const [googleError, setGoogleError] = useState<SinopiaMessageCode | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);
  const titleId = useId();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  /* This screen's own Google failure first; otherwise what the session has to say. */
  const banner = googleError === undefined ? (notice === dismissedNotice ? undefined : notice) : { code: googleError };

  const handleSubmit = useCallback(
    async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      setIsPending(true);
      setError(undefined);
      setGoogleError(undefined);
      const result = await sinopiaSession().signIn(email.trim(), password);
      /* Signed in, the gate swaps this screen for the access check as the session announces itself. */
      if (!result.ok) {
        setError(result.code);
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

  if (banner?.link !== undefined) {
    return (
      <SinopiaAuthFrame
        titleId={titleId}
        title={t('auth.refused')}
        description={<span role='alert'>{t(`auth.messages.${banner.code}`)}</span>}
        footer={<SinopiaLanguageSwitch />}
      >
        <div className='flex flex-col gap-3'>
          <a href={banner.link.href} className='text-center font-medium underline underline-offset-4'>
            {t('auth.goToSinopia')}
          </a>
          <Button
            variant='ghost'
            onClick={() => {
              setDismissedNotice(notice);
            }}
          >
            {t('auth.signOut')}
          </Button>
        </div>
      </SinopiaAuthFrame>
    );
  }

  return (
    <SinopiaAuthFrame
      titleId={titleId}
      title={t('auth.signIn.title')}
      description={t('auth.signIn.description')}
      footer={<SinopiaLanguageSwitch />}
    >
      <div className='flex flex-col gap-6'>
        {banner === undefined ? null : (
          <div role='alert' className='flex flex-col gap-2 rounded-md border border-destructive/30 p-3 text-sm'>
            <p>{t(`auth.messages.${banner.code}`)}</p>
          </div>
        )}
        <SinopiaGoogleButton isDisabled={isPending} onStart={handleGoogleStart} onError={setGoogleError} />
        <FieldSeparator className='m-0 flex items-center text-xs *:data-[slot=field-separator-content]:bg-card'>
          {t('auth.signIn.separator')}
        </FieldSeparator>
        <form
          aria-labelledby={titleId}
          aria-busy={isPending}
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <FieldGroup>
            <Field data-invalid={error === undefined ? undefined : true}>
              <Label htmlFor={emailId}>{t('auth.signIn.email')}</Label>
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
              <Label htmlFor={passwordId}>{t('auth.signIn.password')}</Label>
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
                {t(`auth.messages.${error}`)}
              </p>
            )}
            <Button type='submit' disabled={isPending}>
              {isPending ? <Spinner aria-hidden /> : null}
              <span role={isPending ? 'status' : undefined}>
                {isPending ? t('auth.signIn.pending') : t('auth.signIn.submit')}
              </span>
            </Button>
          </FieldGroup>
        </form>
        <a
          href='https://sinopialab.com/auth'
          target='_blank'
          rel='noopener noreferrer'
          className='text-center text-sm underline underline-offset-4'
        >
          {t('auth.signIn.register')}
        </a>
      </div>
    </SinopiaAuthFrame>
  );
}
