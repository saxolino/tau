import { Button } from '@taucad/ui/components/button';
import { Switch } from '@taucad/ui/components/switch';
import { SettingsItem } from '#components/settings/settings-item.js';
import { useTranslation } from '#i18n/translate.js';
import { languages, setLanguage } from '#i18n/language.js';
import { selectableTheme, useTheme } from '#hooks/use-theme.js';
import { useCookie } from '#hooks/use-cookie.js';
import { cookieName } from '#constants/cookie.constants.js';

/** Appearance controls use the same preference owners as the account menu. */
export function SinopiaAppearanceSettings(): React.JSX.Element {
  const { t, language } = useTranslation();
  const { themeWithSystem, setTheme, options } = useTheme();
  const [pointerCursors, setPointerCursors] = useCookie(cookieName.pointerCursors, false);
  return (
    <div className='flex flex-col gap-6'>
      <SettingsItem settingId='theme'>
        <div role='group' aria-label={t('account.theme.label')} className='flex flex-wrap items-center gap-2'>
          <span className='mr-auto'>{t('account.theme.label')}</span>
          {options.map((option) => (
            <Button
              key={String(option.id)}
              variant='outline'
              aria-pressed={selectableTheme(themeWithSystem) === option.id}
              onClick={() => {
                setTheme(option.id);
              }}
            >
              {option.name}
            </Button>
          ))}
        </div>
      </SettingsItem>
      <SettingsItem settingId='language'>
        <div role='group' aria-label={t('account.language.label')} className='flex flex-wrap items-center gap-2'>
          <span className='mr-auto'>{t('account.language.label')}</span>
          {languages.map((value) => (
            <Button
              key={value}
              variant='outline'
              lang={value}
              aria-pressed={language === value}
              onClick={() => {
                setLanguage(value);
              }}
            >
              {t(`account.language.${value}`)}
            </Button>
          ))}
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
