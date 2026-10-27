// Native semantics and admission for one editable number row. The row owns its own draft, so only
// the pure value rules live here.
import type { ParameterBinding } from '@taucad/parameters';
import type { UnitDiagnostic } from '@taucad/units/unit';

/** Native semantics of one editable field, projected out of its admitted manifest binding. */
export type ParameterFieldBinding = Readonly<{
  /** Absent for an ordinary number whose semantics are unknown; `1` is explicit dimensionless. */
  nativeUnit?: string;
  representation: ParameterBinding['representation'];
  constraints: ParameterBinding['constraints'];
  quantityKind?: string;
  space?: ParameterBinding['space'];
  reference?: string;
}>;

/** Language of a field's messages: Italian for an Italian locale, English otherwise. */
export type FieldLanguage = 'it' | 'en';

/**
 * The language of a field's messages from its locale (or the browser's).
 *
 * @param locale - The field's locale, when given.
 * @returns `it` for an Italian locale, `en` otherwise.
 */
export const fieldLanguage = (locale: string | undefined): FieldLanguage =>
  (locale ?? globalThis.navigator?.language ?? 'en').toLowerCase().startsWith('it') ? 'it' : 'en';

const fieldNumber = (value: number, language: FieldLanguage): string =>
  language === 'it' ? value.toLocaleString('it-IT', { maximumFractionDigits: 6 }) : String(value);

const fieldMessages = {
  en: {
    decimal: 'Decimal input requires a decimal execution engine.',
    finite: 'Parameter values must be finite.',
    whole: 'Enter a whole number.',
    atLeast: (n: string) => `Value must be at least ${n}.`,
    atMost: (n: string) => `Value must be at most ${n}.`,
    greater: (n: string) => `Value must be greater than ${n}.`,
    less: (n: string) => `Value must be less than ${n}.`,
    multiple: (n: string) => `Value must be a multiple of ${n}.`,
    constant: 'Value does not match the required constant.',
    choices: 'Value is not one of the admitted choices.',
  },
  it: {
    decimal: 'I decimali esatti richiedono un motore decimale.',
    finite: 'Il valore deve essere un numero finito.',
    whole: 'Scrivi un numero intero.',
    atLeast: (n: string) => `Il valore deve essere almeno ${n}.`,
    atMost: (n: string) => `Il valore deve essere al massimo ${n}.`,
    greater: (n: string) => `Il valore deve essere maggiore di ${n}.`,
    less: (n: string) => `Il valore deve essere minore di ${n}.`,
    multiple: (n: string) => `Il valore deve essere un multiplo di ${n}.`,
    constant: 'Il valore non corrisponde a quello richiesto.',
    choices: 'Il valore non è fra le scelte ammesse.',
  },
} as const;

/**
 * A typed entry the units parser refused, in the field's language: the parser speaks English, the Italian field
 * says what to type instead.
 *
 * @param diagnostic - The parser's diagnostic.
 * @param language - The field's language.
 * @returns The message to show under the field.
 */
export const inputDiagnosticMessage = (diagnostic: UnitDiagnostic, language: FieldLanguage): string => {
  if (language === 'en') {
    return diagnostic.message;
  }
  switch (diagnostic.code) {
    case 'NUMERIC_OVERFLOW':
    case 'NUMERIC_UNDERFLOW': {
      return 'Numero fuori scala.';
    }
    case 'UNIT_UNKNOWN':
    case 'UNIT_UNSUPPORTED': {
      return 'Unità non riconosciuta: scrivi per esempio 3,5 mm.';
    }
    case 'DIMENSION_MISMATCH':
    case 'KIND_MISMATCH':
    case 'SPACE_MISMATCH': {
      return 'Unità non adatta a questa misura.';
    }
    default: {
      return 'Numero non valido: scrivi per esempio 3,5 o 3.5.';
    }
  }
};

/** Reject a native value the producer's declaration cannot accept, before any authority round trip. */
export const validateParameterInputValue = (
  binding: ParameterFieldBinding,
  value: number,
  language: FieldLanguage = 'en',
): UnitDiagnostic | undefined => {
  const messages = fieldMessages[language];
  const number = (n: number): string => fieldNumber(n, language);
  if (binding.representation === 'decimal') {
    return {
      code: 'REPRESENTATION_UNSUPPORTED',
      message: messages.decimal,
    };
  }
  if (!Number.isFinite(value)) {
    return { code: 'REPRESENTATION_UNSUPPORTED', message: messages.finite };
  }
  if (binding.representation === 'safe-integer' && !Number.isSafeInteger(value)) {
    return {
      code: 'REPRESENTATION_UNSUPPORTED',
      message: messages.whole,
    };
  }
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf } = binding.constraints;
  if (typeof minimum === 'number' && value < minimum) {
    return { code: 'METADATA_CONFLICT', message: messages.atLeast(number(minimum)) };
  }
  if (typeof maximum === 'number' && value > maximum) {
    return { code: 'METADATA_CONFLICT', message: messages.atMost(number(maximum)) };
  }
  if (typeof exclusiveMinimum === 'number' && value <= exclusiveMinimum) {
    return { code: 'METADATA_CONFLICT', message: messages.greater(number(exclusiveMinimum)) };
  }
  if (typeof exclusiveMaximum === 'number' && value >= exclusiveMaximum) {
    return { code: 'METADATA_CONFLICT', message: messages.less(number(exclusiveMaximum)) };
  }
  if (typeof multipleOf === 'number' && multipleOf > 0) {
    const quotient = value / multipleOf;
    if (Math.abs(quotient - Math.round(quotient)) > Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8) {
      return { code: 'METADATA_CONFLICT', message: messages.multiple(number(multipleOf)) };
    }
  }
  if (Object.hasOwn(binding.constraints, 'const') && !Object.is(value, binding.constraints['const'])) {
    return { code: 'METADATA_CONFLICT', message: messages.constant };
  }
  if (
    Array.isArray(binding.constraints['enum']) &&
    !binding.constraints['enum'].some((candidate) => Object.is(candidate, value))
  ) {
    return { code: 'METADATA_CONFLICT', message: messages.choices };
  }
  return undefined;
};
