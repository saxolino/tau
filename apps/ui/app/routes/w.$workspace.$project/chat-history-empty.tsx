import { MessageSquare } from 'lucide-react';
import { PanelEmptyState } from '@taucad/ui/components/panel-empty-state';
import { useTranslation } from '#i18n/translate.js';
import { cn } from '@taucad/ui/utils/cn';

export function ChatHistoryEmpty({ className }: { readonly className?: string }): React.JSX.Element {
  const { t } = useTranslation();
  // SinopiaCAD: the agent's empty state in the design's words (UI-UX-SinopiaCAD §2.4).
  return (
    <PanelEmptyState
      icon={MessageSquare}
      title={t('project.agent.emptyTitle')}
      description={t('project.agent.emptyText')}
      className={cn('m-auto h-auto max-w-xs py-6 [container-type:inline-size]', className)}
    />
  );
}
