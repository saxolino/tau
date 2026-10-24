import { Switch } from '@taucad/ui/components/switch';
import { ToggleGroup, ToggleGroupItem } from '@taucad/ui/components/toggle-group';
import { SettingsItem } from '#components/settings/settings-item.js';
import { useTranslation } from '#i18n/translate.js';
import { languages, setLanguage } from '#i18n/language.js';
import { selectableTheme, useTheme } from '#hooks/use-theme.js';
import { useCookie } from '#hooks/use-cookie.js';
import { cookieName } from '#constants/cookie.constants.js';
import { useSinopiaTools } from '#hooks/use-sinopia-tools.js';
import type { SinopiaTool } from '#hooks/use-sinopia-tools.js';

/** The system's choice as a toggle value; `null` cannot be one. */
const systemValue = 'system';

/** Appearance controls use the same preference owners as the account menu, and show the current choice the same way. */
export function SinopiaAppearanceSettings(): React.JSX.Element {
  const { t, language } = useTranslation();
  const { themeWithSystem, setTheme, options } = useTheme();
  const [pointerCursors, setPointerCursors] = useCookie(cookieName.pointerCursors, false);
  return (
    <div className='flex flex-col gap-6'>
      <SettingsItem settingId='theme'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='mr-auto'>{t('account.theme.label')}</span>
          <ToggleGroup
            type='single'
            variant='outline'
            spacing={0}
            aria-label={t('account.theme.label')}
            value={selectableTheme(themeWithSystem) ?? systemValue}
            onValueChange={(next) => {
              const option = options.find((candidate) => (candidate.id ?? systemValue) === next);
              if (option !== undefined) {
                setTheme(option.id);
              }
            }}
          >
            {options.map((option) => (
              <ToggleGroupItem key={String(option.id)} value={option.id ?? systemValue} className='px-3'>
                {option.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </SettingsItem>
      <SettingsItem settingId='language'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='mr-auto'>{t('account.language.label')}</span>
          <ToggleGroup
            type='single'
            variant='outline'
            spacing={0}
            aria-label={t('account.language.label')}
            value={language}
            onValueChange={(next) => {
              const value = languages.find((candidate) => candidate === next);
              if (value !== undefined) {
                setLanguage(value);
              }
            }}
          >
            {languages.map((value) => (
              <ToggleGroupItem key={value} value={value} lang={value} className='px-3'>
                {t(`account.language.${value}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </SettingsItem>
      <SettingsItem settingId='pointer-cursors'>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <p>{t('account.settings.cursors')}</p>
            <p className='text-sm text-muted-foreground'>{t('account.settings.cursorsDescription')}</p>
          </div>
          <Switch
            aria-label={t('account.settings.cursors')}
            checked={pointerCursors}
            onCheckedChange={setPointerCursors}
          />
        </div>
      </SettingsItem>
    </div>
  );
}

/** The CAD's existing model unit is millimetres; this is information, not a fictitious unit conversion. */
export function SinopiaModelSettings(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <SettingsItem settingId='units'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <p>{t('account.settings.units')}</p>
          <p className='text-sm text-muted-foreground'>{t('account.settings.unitsDescription')}</p>
        </div>
        <span>mm</span>
      </div>
    </SettingsItem>
  );
}

/**
 * Impostazioni › Strumenti: Tau functions a designer may want, each switched on or off here. Page tools show under
 * «Strumenti» in the sidebar, panel tools under «+» beside «Misure».
 */
export function SinopiaToolsSettings(): React.JSX.Element {
  const { t } = useTranslation();
  const { tools, isEnabled, setEnabled } = useSinopiaTools();
  const groups: ReadonlyArray<{ readonly id: string; readonly label: string; readonly tools: readonly SinopiaTool[] }> =
    [
      { id: 'pages', label: t('tools.pageGroup'), tools: tools.filter((tool) => tool.kind === 'page') },
      { id: 'panels', label: t('tools.panelGroup'), tools: tools.filter((tool) => tool.kind === 'panel') },
    ];
  return (
    <div className='flex flex-col gap-6'>
      <p className='text-sm text-muted-foreground'>{t('tools.intro')}</p>
      {groups.map((group) => (
        <section key={group.id} aria-label={group.label} className='flex flex-col gap-4'>
          <h3 className='text-xs font-medium text-muted-foreground'>{group.label}</h3>
          {group.tools.map((tool) => (
            <SettingsItem key={tool.id} settingId={`tool-${tool.id}`}>
              <div className='flex items-center justify-between gap-4'>
                <div className='flex items-start gap-3'>
                  <tool.icon aria-hidden className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                  <div>
                    <p>{t(`tools.${tool.id}.label`)}</p>
                    <p className='text-sm text-muted-foreground'>{t(`tools.${tool.id}.description`)}</p>
                  </div>
                </div>
                <Switch
                  aria-label={t(`tools.${tool.id}.label`)}
                  checked={isEnabled(tool.id)}
                  onCheckedChange={(isOn) => {
                    setEnabled(tool.id, isOn);
                  }}
                />
              </div>
            </SettingsItem>
          ))}
        </section>
      ))}
    </div>
  );
}
