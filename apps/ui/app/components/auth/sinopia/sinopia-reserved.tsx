import { useId } from 'react';
import { Button } from '@taucad/ui/components/button';
import { SinopiaAuthFrame } from '#components/auth/sinopia/sinopia-auth-frame.js';
import { useTranslation } from '#i18n/translate.js';
import { sinopiaSession } from '#lib/sinopia-session.js';
import type { SinopiaUser } from '#lib/sinopia-session.js';

/** Where an account that is not let in goes back to: Sinopia's own dashboard. */
export const sinopiaReservedBackUrl = 'https://sinopialab.com/dashboard';

/**
 * SinopiaCAD: the reserved preview. The account is a valid Sinopia account but not an administrator, so nothing of the
 * workspace (editor, projects, AI calls) is loaded; the person goes back to Sinopia or leaves.
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
          {t('auth.reserved.signOut')}
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
