import { PageHeader } from '#components/layout/page-header.js';
import { Link } from 'react-router';
import { buttonVariants } from '@taucad/ui/components/button';
import { useTranslation } from '#i18n/translate.js';

/** A missing page offers a direct route back to the designer's projects. */
export function PageNotFound(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      role='alert'
      className='flex min-h-full flex-1 flex-col items-center justify-center gap-4 px-4 py-8 text-center'
    >
      <PageHeader title={t('common.pageNotFound')} />
      <p className='max-w-sm text-sm text-muted-foreground'>{t('common.pageMissing')}</p>
      <Link to='/projects' className={buttonVariants()}>
        {t('common.projects')}
      </Link>
    </div>
  );
}
