import { useId } from 'react';
import { Button } from '@taucad/ui/components/button';
import { SinopiaAuthFrame } from '#components/auth/sinopia/sinopia-auth-frame.js';
import { useTranslation } from '#i18n/translate.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import type { SinopiaUser } from '#lib/sinopia-session.js';
import type { SinopiaNotice } from '#lib/sinopia-access.js';

/** Where an account that is not let in goes back to: Sinopia's own dashboard. */
export const sinopiaReservedBackUrl = 'https://sinopialab.com/dashboard';

/** Leave on request only: on sinopialab.com the session is Sinopia's own too. */
const signOut = (): void => {
  // async-iife: bootstrap -- signing out announces itself; the gate then shows the sign-in screen.
  void (async (): Promise<void> => {
    try {
      await sinopiaSession().signOut();
    } catch (error) {
      console.error('[sinopia] sign-out failed', error);
    }
  })();
};

/**
 * SinopiaCAD: the reserved pilot. The account is a valid Sinopia account outside the pilot list of Sinopia's function,
 * so nothing of the workspace (editor, projects, AI calls) is loaded; the person goes back to Sinopia or leaves.
 *
 * @param properties - The signed-in account.
 * @returns The screen.
 */
export function SinopiaReserved({ user }: { readonly user: SinopiaUser }): React.JSX.Element {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <SinopiaAuthFrame
      titleId={titleId}
      title={t('auth.reserved.title')}
      description={
        <span role='status'>
          {t('auth.reserved.description', { email: user.email ?? t('auth.secondFactor.accountFallback') })}
        </span>
      }
    >
      <div className='flex flex-col gap-3'>
        <Button asChild>
          <a href={sinopiaReservedBackUrl}>{t('auth.reserved.back')}</a>
        </Button>
        <Button type='button' variant='ghost' onClick={signOut}>
          {t('auth.reserved.signOut')}
        </Button>
      </div>
    </SinopiaAuthFrame>
  );
}

/**
 * SinopiaCAD: an account sinopialab.com itself would keep out (Terms, profession, profile). The notice says where to put
 * it right; the session is not dropped (it is also sinopialab.com's), so once done there «controlla di nuovo» checks
 * again here. Leaving is the person's choice.
 *
 * @param properties - The notice of why the account stays out.
 * @returns The screen.
 */
export function SinopiaRefused({ notice }: { readonly notice: SinopiaNotice }): React.JSX.Element {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <SinopiaAuthFrame
      titleId={titleId}
      title={t('auth.refused')}
      description={<span role='alert'>{t(`auth.messages.${notice.code}`)}</span>}
    >
      <div className='flex flex-col gap-3'>
        {notice.link === undefined ? null : (
          <a href={notice.link.href} className='text-center font-medium underline underline-offset-4'>
            {t('auth.goToSinopia')}
          </a>
        )}
        <Button
          type='button'
          onClick={() => {
            sinopiaSession().retryAccess();
          }}
        >
          {t('auth.checkAgain')}
        </Button>
        <Button type='button' variant='ghost' onClick={signOut}>
          {t('auth.signOut')}
        </Button>
      </div>
    </SinopiaAuthFrame>
  );
}

/**
 * SinopiaCAD on the web without Sinopia's project configured: the workspace stays closed (fail-closed), because the
 * administrator-only gate cannot run without it.
 *
 * @returns The screen.
 */
export function SinopiaNotConfigured(): React.JSX.Element {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <SinopiaAuthFrame
      titleId={titleId}
      title={t('auth.notConfigured.title')}
      description={<span role='status'>{t('auth.notConfigured.description')}</span>}
    >
      <Button asChild>
        <a href={sinopiaReservedBackUrl}>{t('auth.reserved.back')}</a>
      </Button>
    </SinopiaAuthFrame>
  );
}
