import type { ComponentProps, ReactNode } from 'react';
import { Card } from '@taucad/ui/components/card';
import { cn } from '@taucad/ui/utils/cn';
import { useTranslation } from '#i18n/translate.js';
import type { SettingId } from '#components/settings/settings-registry.js';
import { getSettingsSections, tauSettingsSections } from '#components/settings/settings-registry.js';

type SettingsItemProps = {
  readonly settingId: SettingId;
  readonly children: ReactNode;
  readonly className?: string;
};

/**
 * An explicit, focusable destination for a registered setting.
 *
 * Sinopia navigation uses its translated catalogue; retained Tau panels still
 * resolve their original landmarks without being exposed in the dialog. A setting
 * absent from both deployment catalogues renders nothing. Unknown ids are a
 * compile error via `SettingId`.
 */
export function SettingsItem({ settingId, children, className }: SettingsItemProps): React.JSX.Element | undefined {
  const { t } = useTranslation();
  const definition = [...getSettingsSections(t), ...tauSettingsSections]
    .flatMap((section) => section.entries)
    .find((entry) => entry.id === settingId);
  if (!definition) {
    return undefined;
  }
  return (
    <section
      id={`settings-${settingId}`}
      data-slot='settings-item'
      aria-label={definition.label}
      tabIndex={-1}
      className={cn('relative scroll-m-4 rounded-lg focus-visible:focus-outline', className)}
    >
      {children}
    </section>
  );
}

/** Marks a top-level settings section without restyling nested product cards. */
export function SettingsSectionCard(properties: ComponentProps<typeof Card>): React.JSX.Element {
  return <Card data-settings-section {...properties} />;
}
