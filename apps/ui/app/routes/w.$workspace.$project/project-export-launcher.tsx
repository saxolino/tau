import { Button } from '@taucad/ui/components/button';
import { useTranslation } from '#i18n/translate.js';
import { useProjectWorkspace } from '#routes/w.$workspace.$project/project-workspace-context.js';

/** Old saved export tabs and mobile panels lead to the same format-check dialog. */
export function ProjectExportLauncher(): React.JSX.Element {
  const { t } = useTranslation();
  const { openPanel } = useProjectWorkspace();
  return (
    <div className='p-4'>
      <Button
        variant='outline'
        onClick={() => {
          openPanel('export');
        }}
      >
        {t('project.topBar.export')}
      </Button>
    </div>
  );
}
