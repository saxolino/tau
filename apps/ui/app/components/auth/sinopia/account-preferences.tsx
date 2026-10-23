import { DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@taucad/ui/components/dropdown-menu';
import { cn } from '@taucad/ui/utils/cn';
import { selectableTheme, useTheme } from '#hooks/use-theme.js';
import { isLanguage, languages, setLanguage } from '#i18n/language.js';
import { useTranslation } from '#i18n/translate.js';

/** One segment: the value it selects and its visible label. */
type Segment = Readonly<{ value: string; label: string }>;

/**
 * A segmented control inside the account menu, as the viewer's settings menu draws one: a row of equal segments, each
 * a menu radio item, so the menu's arrow keys reach them and Enter or Space selects; the menu stays open after a choice.
 */
function MenuSegments({
  label,
  value,
  segments,
  onValueChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly segments: readonly Segment[];
  readonly onValueChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <>
      <DropdownMenuLabel className='pt-2 pb-1 text-xs font-normal text-muted-foreground'>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        aria-label={label}
        value={value}
        className='mx-2 mb-1 flex flex-row gap-0.5 rounded-md border border-input p-0.5'
        onValueChange={(next) => {
          if (next !== value) {
            onValueChange(next);
          }
        }}
      >
        {segments.map((segment) => (
          <DropdownMenuRadioItem
            key={segment.value}
            value={segment.value}
            className={cn(
              'h-6 flex-1 justify-center px-1.5 text-xs whitespace-nowrap',
              'data-[state=checked]:bg-menu-highlight data-[state=checked]:font-medium data-[state=checked]:text-foreground',
              '[&>[data-slot=dropdown-menu-radio-item-indicator]]:hidden',
            )}
            onSelect={(event) => {
              // A setting, not a command: the menu stays open so the change shows at once behind it.
              event.preventDefault();
            }}
          >
            {segment.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

/** The system's choice as a radio value; `null` cannot be one. */
const systemValue = 'system';

/**
 * Theme and language in the account menu (UI-UX-SinopiaCAD §7): «Tema: Chiaro · Nero · Sistema» and
 * «Lingua: Italiano · English», both applied at once. The language is remembered on this device.
 *
 * @returns The two segmented rows.
 */
export function AccountPreferences(): React.JSX.Element {
  const { t, language } = useTranslation();
  const { themeWithSystem, setTheme, options } = useTheme();
  const shownTheme = selectableTheme(themeWithSystem);

  return (
    <>
      <MenuSegments
        label={t('account.theme.label')}
        value={shownTheme ?? systemValue}
        segments={options.map((option) => ({ value: option.id ?? systemValue, label: option.name }))}
        onValueChange={(next) => {
          const option = options.find((candidate) => (candidate.id ?? systemValue) === next);
          if (option !== undefined) {
            setTheme(option.id);
          }
        }}
      />
      <MenuSegments
        label={t('account.language.label')}
        value={language}
        segments={languages.map((value) => ({ value, label: t(`account.language.${value}`) }))}
        onValueChange={(next) => {
          if (isLanguage(next)) {
            setLanguage(next);
          }
        }}
      />
    </>
  );
}
