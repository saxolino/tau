import { PageHeader } from '#components/layout/page-header.js';
import { useEffect } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Button, buttonVariants } from '@taucad/ui/components/button';
import { useAnalytics } from '#hooks/use-analytics.js';
import { PageNotFound } from '#components/page-not-found.js';
import { reportUiError } from '#lib/error-reporting.js';

import { useTranslation } from '#i18n/translate.js';

export function ErrorPage(): React.JSX.Element {
  const error = useRouteError();
  const { t } = useTranslation();
  const analytics = useAnalytics();

  useEffect(() => {
    // Don't report 404 errors to analytics - they're expected user behavior
    if (isRouteErrorResponse(error) && error.status === 404) {
      return;
    }

    console.error('[sinopiacad] application error', error);
    if (isRouteErrorResponse(error)) {
      const routeError = new Error(`${error.status} ${error.statusText}`);
      routeError.name = 'route_error';
      analytics.captureException(routeError, { context: { component: 'ErrorPage' } });
      if (error.status >= 500) {
        void reportUiError(routeError);
      }
    } else if (error instanceof Error) {
      analytics.captureException(error, { context: { component: 'ErrorPage' } });
      void reportUiError(error);
    }
  }, [error, analytics]);

  const refreshPage = (): void => {
    globalThis.location.reload();
  };

  // Handle 404 errors with the dedicated PageNotFound component
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <PageNotFound />;
  }

  return (
    <div
      role='alert'
      className='flex min-h-full flex-1 flex-col items-center justify-center gap-4 px-4 py-8 text-center'
    >
      <PageHeader title={t('common.appError')} />
      <p className='max-w-sm text-sm text-muted-foreground'>{t('common.appRecovery')}</p>
      <div className='flex flex-wrap justify-center gap-2'>
        <Link to='/projects' className={buttonVariants({ variant: 'outline' })}>
          {t('common.projects')}
        </Link>
        <Button onClick={refreshPage}>{t('common.reload')}</Button>
      </div>
    </div>
  );
}
