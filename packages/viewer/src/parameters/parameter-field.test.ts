import { describe, expect, it } from 'vitest';
import { fieldLanguage, inputDiagnosticMessage, validateParameterInputValue } from '#parameters/parameter-field.js';
import type { ParameterFieldBinding } from '#parameters/parameter-field.js';

const binding: ParameterFieldBinding = { representation: 'binary64', constraints: { minimum: 1.8, maximum: 20 } };

describe('field messages', () => {
  it('should speak Italian for an Italian locale and English otherwise', () => {
    expect(fieldLanguage('it-IT')).toBe('it');
    expect(fieldLanguage('IT')).toBe('it');
    expect(fieldLanguage('en-NZ')).toBe('en');
  });

  it('should say the bounds in the field language, with the locale decimal separator', () => {
    expect(validateParameterInputValue(binding, 1, 'it')?.message).toBe('Il valore deve essere almeno 1,8.');
    expect(validateParameterInputValue(binding, 30, 'it')?.message).toBe('Il valore deve essere al massimo 20.');
    expect(validateParameterInputValue(binding, 1)?.message).toBe('Value must be at least 1.8.');
    expect(validateParameterInputValue(binding, 3.5, 'it')).toBeUndefined();
  });

  it('should turn a refused entry into an Italian hint, and keep the parser words in English', () => {
    const diagnostic = {
      code: 'REPRESENTATION_UNSUPPORTED',
      message: 'Locale grouping is malformed or ambiguous.',
    } as const;
    expect(inputDiagnosticMessage(diagnostic, 'it')).toBe('Numero non valido: scrivi per esempio 3,5 o 3.5.');
    expect(inputDiagnosticMessage(diagnostic, 'en')).toBe(diagnostic.message);
  });
});
