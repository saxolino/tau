import { DownloadIcon } from 'lucide-react';
import { useProjectWorkspace } from '#routes/w.$workspace.$project/project-workspace-context.js';
import { Button } from '@taucad/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@taucad/ui/components/tooltip';
import { useTranslation } from '#i18n/translate.js';

export function ProjectExportAction({
  ref,
  className,
  labelClassName,
}: {
  readonly ref?: React.Ref<HTMLButtonElement>;
  readonly className?: string;
  readonly labelClassName?: string;
} = {}): React.JSX.Element {
  const { t } = useTranslation();
  const { openPanel } = useProjectWorkspace();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant='ghost'
          size='xs'
          className={className ?? 'h-7 px-2 max-md:size-8'}
          aria-label={t('project.topBar.export')}
          onClick={() => {
            openPanel('export');
          }}
        >
          <DownloadIcon className='size-3.5' aria-hidden />
          <span className={labelClassName ?? 'hidden @xl/viewer:inline'}>{t('project.topBar.export')}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('project.topBar.exportTooltip')}</TooltipContent>
    </Tooltip>
  );
}
