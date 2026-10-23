import { ArrowLeft, FolderX, Home } from 'lucide-react';
import { useNavigate, Link } from 'react-router';
import { Button, buttonVariants } from '@taucad/ui/components/button';
import {
  FloatingPanel,
  FloatingPanelContent,
  FloatingPanelContentHeader,
  FloatingPanelContentTitle,
  FloatingPanelContentBody,
} from '#components/ui/floating-panel.js';
import { useTranslation } from '#i18n/translate.js';
import { cn } from '@taucad/ui/utils/cn';

type ProjectNotFoundProperties = {
  readonly className?: string;
};

export function ProjectNotFound({ className }: ProjectNotFoundProperties): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const goBack = (): void => {
    void navigate(-1);
  };

  return (
    <div role='alert' className={cn('absolute inset-0 z-20', className)}>
      <FloatingPanel isOpen side='right' align='start'>
        <FloatingPanelContent>
          <FloatingPanelContentHeader>
            <FloatingPanelContentTitle>{t('project.notFound.title')}</FloatingPanelContentTitle>
          </FloatingPanelContentHeader>

          <FloatingPanelContentBody className='flex items-center justify-center p-6'>
            <div className='w-full max-w-sm animate-in duration-300 fade-in'>
              {/* Icon */}
              <div className='mb-6 text-center'>
                <div className='mb-4 flex items-center justify-center'>
                  <div className='flex size-16 items-center justify-center rounded-full bg-muted/50 dark:bg-muted/30'>
                    <FolderX className='size-8 text-muted-foreground' />
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className='mb-6 rounded-lg border border-border/60 bg-card/80 p-4 text-center shadow-sm dark:border-border/40 dark:bg-card/50'>
                <p className='text-muted-foreground'>{t('project.notFound.text')}</p>
              </div>

              {/* Action Buttons */}
              <div className='flex flex-col gap-3 sm:flex-row'>
                <Button variant='outline' className='flex-1' onClick={goBack}>
                  <ArrowLeft className='mr-2 size-4' />
                  {t('project.notFound.back')}
                </Button>

                <Link to='/projects' className={cn(buttonVariants(), 'flex-1')}>
                  <Home className='mr-2 size-4' />
                  {t('project.notFound.projects')}
                </Link>
              </div>
            </div>
          </FloatingPanelContentBody>
        </FloatingPanelContent>
      </FloatingPanel>
    </div>
  );
}
