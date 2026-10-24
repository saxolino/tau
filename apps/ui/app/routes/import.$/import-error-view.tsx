import { ToolPage } from '#components/layout/tool-page.js';
import { PageNotice } from '#components/layout/page-notice.js';
import { RotateCcw } from 'lucide-react';
import { Button } from '@taucad/ui/components/button';
import { useTranslation } from '#i18n/translate.js';

type ImportErrorViewProperties = {
  readonly error: Error | undefined;
  readonly title?: string;
  readonly message?: string;
  readonly onRetry: () => void;
};

/** Shared error view for import failures. */
export function ImportErrorView({ error, title, message, onRetry }: ImportErrorViewProperties): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <ToolPage title={t('import.title')}>
      <PageNotice
        title={title ?? t('import.error.title')}
        message={message ?? t('import.error.message')}
        detail={error?.message ?? t('import.error.noDetail')}
      >
        <Button variant='outline' onClick={onRetry}>
          <RotateCcw />
          {t('common.retry')}
        </Button>
      </PageNotice>
    </ToolPage>
  );
}
