import { Checkbox } from '@taucad/ui/components/checkbox';
import { Label } from '@taucad/ui/components/label';
import { Button } from '@taucad/ui/components/button';
import type { ConverterExportFormat } from '@taucad/converter/runtime';
import { useTranslation } from '#i18n/translate.js';
import type { PlainMessageKey } from '#i18n/translate.js';

type FormatSelectorProperties = {
  readonly formats: readonly ConverterExportFormat[];
  readonly selectedFormats: ConverterExportFormat[];
  readonly onFormatToggle: (format: ConverterExportFormat) => void;
  readonly onClearSelection: () => void;
  readonly headingText?: string;
  readonly clearButtonText?: string;
};

/** What a designer uses each well-known format for; the others show their code alone. */
const formatHints: Partial<Record<string, PlainMessageKey>> = {
  step: 'convert.formats.step',
  stp: 'convert.formats.step',
  stl: 'convert.formats.stl',
  obj: 'convert.formats.obj',
  glb: 'convert.formats.glb',
  gltf: 'convert.formats.gltf',
  '3mf': 'convert.formats.threeMf',
  '3dm': 'convert.formats.threeDm',
  usdz: 'convert.formats.usdz',
};

export function FormatSelector({
  formats,
  selectedFormats,
  onFormatToggle,
  onClearSelection,
  headingText,
  clearButtonText,
}: FormatSelectorProperties): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className='space-y-3'>
      <div className='flex min-h-7 flex-row items-center justify-between'>
        <h3 className='text-sm font-medium'>{headingText ?? t('convert.formats.heading')}</h3>
        {selectedFormats.length > 0 ? (
          <Button variant='ghost' size='xs' onClick={onClearSelection}>
            {clearButtonText ?? t('convert.formats.clear')}
          </Button>
        ) : undefined}
      </div>
      <div className='space-y-2'>
        {formats.map((format) => {
          const isChecked = selectedFormats.includes(format);
          const formatId = `format-${format}`;
          const hint = formatHints[format];

          return (
            <div key={format} className='flex items-start space-x-2'>
              <Checkbox
                id={formatId}
                checked={isChecked}
                onCheckedChange={() => {
                  onFormatToggle(format);
                }}
              />
              <Label
                htmlFor={formatId}
                className='cursor-action flex-wrap gap-x-2 gap-y-0.5 rounded-sm text-sm leading-none font-normal transition-colors peer-disabled:cursor-not-allowed peer-disabled:opacity-70 hover:bg-accent'
              >
                <span className='font-mono'>{format.toUpperCase()}</span>
                {hint === undefined ? undefined : <span className='text-xs text-muted-foreground'>{t(hint)}</span>}
              </Label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
