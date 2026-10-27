import { lengthUnitOptions } from '#constants/length-units.js';

/**
 * Maximum digits for formatting grid size values in engineering notation.
 */
export const maxGridDigits = 3;

/**
 * Ordered list of supported grid unit symbols for the unit selector.
 */
export const gridUnitOrder = lengthUnitOptions.map(({ symbol }) => symbol);

/** Italian names of the units a designer can pick (SinopiaCAD works in millimetres only). */
const visibleUnitLabels: Readonly<Record<string, string>> = { mm: 'Millimetri' };

/**
 * Grid unit options suitable for rendering in a unit selector. SinopiaCAD shows millimetres only: the engine still
 * knows the other units (`lengthUnitOptions`), but they are not offered.
 */
export const gridUnitOptions = lengthUnitOptions
  .filter(({ symbol }) => symbol in visibleUnitLabels)
  .map(({ symbol }) => ({ label: visibleUnitLabels[symbol] ?? symbol, value: symbol }));
