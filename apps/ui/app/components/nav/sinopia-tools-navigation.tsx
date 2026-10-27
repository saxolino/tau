import { Link, useLocation } from 'react-router';
import { SidebarMenuButton, SidebarMenuItem } from '#components/ui/sidebar.js';
import { SidebarSection } from '#components/nav/sidebar-section.js';
import { useSinopiaTools } from '#hooks/use-sinopia-tools.js';
import { useTranslation } from '#i18n/translate.js';

/**
 * The page tools the designer switched on (Impostazioni › Strumenti), under «Strumenti» in the sidebar; nothing when
 * every page tool is off.
 *
 * @returns The section.
 */
export function SinopiaToolsNavigation(): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { enabled } = useSinopiaTools();
  const pages = enabled.flatMap((tool) => (tool.kind === 'page' ? [tool] : []));
  if (pages.length === 0) {
    return undefined;
  }
  return (
    <SidebarSection label={t('tools.sidebarGroup')} className='pt-4'>
      {pages.map((tool) => {
        const isCurrent = pathname === tool.url || pathname.startsWith(`${tool.url}/`);
        return (
          <SidebarMenuItem key={tool.id}>
            <SidebarMenuButton asChild isActive={isCurrent}>
              <Link to={tool.url} aria-current={isCurrent ? 'page' : undefined}>
                <tool.icon aria-hidden />
                <span>{t(`tools.${tool.id}.label`)}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </SidebarSection>
  );
}
