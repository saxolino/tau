import { useId, useRef } from 'react';
import type { ManualVector } from '@taucad/smlib/manual-operations';
import { SliderInput } from '@taucad/ui/components/slider-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@taucad/ui/components/select';

/** A dimension has the same typed and scrubbed editing behaviour as the measures pane. */
export function ManualNumberField({
  label,
  value,
  onChange,
  unit = 'mm',
  min = -500,
  max = 500,
  step = 0.1,
}: Readonly<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}>): React.JSX.Element {
  const id = useId();
  const scrubStart = useRef<number | undefined>(undefined);
  return (
    <div className='grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2'>
      <label htmlFor={id} className='text-sm text-muted-foreground'>
        {label}
      </label>
      <SliderInput
        inputId={id}
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        hasMinimum={false}
        hasMaximum={false}
        trailingAdornment={unit}
        onScrubChange={(next) => {
          scrubStart.current ??= value;
          onChange(next);
        }}
        onScrubCommit={(next) => {
          onChange(next);
          scrubStart.current = undefined;
        }}
        onScrubCancel={() => {
          if (scrubStart.current !== undefined) {
            onChange(scrubStart.current);
          }
          scrubStart.current = undefined;
        }}
        onInputCommit={(next) => {
          onChange(next);
          scrubStart.current = undefined;
        }}
        onStep={(direction, modifiers) => {
          const next = value + direction * step * (modifiers.shift ? 10 : 1);
          onChange(next);
          scrubStart.current = undefined;
        }}
      />
    </div>
  );
}

/** Labelled principal-plane and operation choices use the existing select primitive. */
export function ManualChoice({
  label,
  value,
  choices,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  choices: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}>): React.JSX.Element {
  return (
    <div className='grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-2'>
      <span className='text-sm text-muted-foreground'>{label}</span>
      <Select size='sm' value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className='w-full min-w-0'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Coordinates remain available to keyboard and touch users without dragging. */
export function ManualVectorFields({
  label,
  value,
  onChange,
  unit = 'mm',
}: Readonly<{
  label: string;
  value: ManualVector;
  onChange: (value: ManualVector) => void;
  unit?: string;
}>): React.JSX.Element {
  return (
    <fieldset className='min-w-0 space-y-1'>
      <legend className='mb-2 text-sm font-medium'>{label}</legend>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <ManualNumberField
          key={axis}
          label={`${label} ${axis}`}
          value={value[index] ?? 0}
          unit={unit}
          onChange={(next) => {
            const vector: ManualVector = [...value];
            vector[index] = next;
            onChange(vector);
          }}
        />
      ))}
    </fieldset>
  );
}

export const manualPlanes = [
  { value: 'xy', label: 'XY' },
  { value: 'xz', label: 'XZ' },
  { value: 'yz', label: 'YZ' },
];
