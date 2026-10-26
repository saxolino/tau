import { Box } from 'lucide-react';
import { useTranslation } from '#i18n/translate.js';
import { cn } from '@taucad/ui/utils/cn';

export function ChatHistoryEmpty({ className }: { readonly className?: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={cn('my-auto w-full max-w-xs py-6', className)}>
      <Box aria-hidden className='mb-5 size-6 text-muted-foreground' />
      <p className='mb-2 text-xs font-medium text-muted-foreground'>{t('project.agent.workMode')}</p>
      <h2 className='text-xl leading-tight font-medium text-foreground'>{t('project.agent.emptyTitle')}</h2>
      <p className='mt-3 text-sm leading-relaxed text-muted-foreground'>{t('project.agent.emptyText')}</p>
      <p className='mt-6 border-t pt-4 text-xs leading-relaxed text-muted-foreground'>
        {t('project.agent.contextHint')}
      </p>
    </div>
  );
}
