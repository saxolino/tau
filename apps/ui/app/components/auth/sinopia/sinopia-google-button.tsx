import { useCallback, useEffect, useState } from 'react';
import { Button } from '@taucad/ui/components/button';
import { Spinner } from '#components/ui/spinner.js';
import { useTranslation } from '#i18n/translate.js';
import type { SinopiaMessageCode } from '#lib/sinopia-access.js';
import { sinopiaSession } from '#lib/sinopia-session.js';

/* oxlint-disable tau-lint/no-hardcoded-color -- Google's trademark colours, fixed by its brand guidelines like a photograph's. */
const googleColors = {
  red: '#EA4335',
  blue: '#4285F4',
  yellow: '#FBBC05',
  green: '#34A853',
} as const;
/* oxlint-enable tau-lint/no-hardcoded-color */

/**
 * Google's «G» in its four colours, as sinopialab.com draws it. It is a trademark whose colours Google's guidelines fix,
 * so like a photograph it neither follows the theme nor takes the palette's tokens.
 *
 * @returns The mark, decorative.
 */
function GoogleMark(): React.JSX.Element {
  return (
    <svg viewBox='0 0 48 48' aria-hidden focusable='false' className='size-4 shrink-0'>
      <path
        fill={googleColors.red}
        d='M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'
      />
      <path
        fill={googleColors.blue}
        d='M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'
      />
      <path
        fill={googleColors.yellow}
        d='M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'
      />
      <path
        fill={googleColors.green}
        d='M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'
      />
    </svg>
  );
}

/**
 * SinopiaCAD's «Continua con Google», as on sinopialab.com: it leaves for Google's account chooser and comes back
 * signed in to the same Sinopia account. While the browser is on its way the button stays busy; coming back to this
 * page with the back button (from the browser's cache, as it was) frees it again.
 *
 * @param properties - Whether another sign-in is under way, and what to do as it starts and when it cannot.
 * @returns The button.
 */
export function SinopiaGoogleButton({
  isDisabled = false,
  onStart,
  onError,
}: {
  readonly isDisabled?: boolean;
  readonly onStart: () => void;
  readonly onError: (code: SinopiaMessageCode) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent): void => {
      if (event.persisted) {
        setIsOpening(false);
      }
    };
    globalThis.addEventListener('pageshow', onPageShow);
    return () => {
      globalThis.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const open = useCallback(async (): Promise<void> => {
    setIsOpening(true);
    onStart();
    const result = await sinopiaSession().signInWithGoogle();
    /* On its way, the browser leaves this page: nothing to reset. */
    if (!result.ok) {
      onError(result.code);
      setIsOpening(false);
    }
  }, [onError, onStart]);

  return (
    <Button
      type='button'
      variant='outline'
      className='w-full'
      disabled={isDisabled || isOpening}
      aria-busy={isOpening || undefined}
      onClick={() => {
        void open();
      }}
    >
      {isOpening ? <Spinner aria-hidden /> : <GoogleMark />}
      {isOpening ? t('auth.signIn.googleOpening') : t('auth.signIn.google')}
    </Button>
  );
}
