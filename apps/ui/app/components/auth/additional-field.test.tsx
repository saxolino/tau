// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdditionalField as AdditionalFieldConfig } from '@better-auth-ui/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdditionalField } from '#components/auth/additional-field.js';

afterEach(cleanup);

describe('custom additional field form binding', () => {
  it('submits a changed controlled value and reports blur validation without requiring a named custom input', async () => {
    const validate = vi.fn((value: unknown) => {
      if (value === 'invalid') {
        throw new Error('Choose another value');
      }
    });
    const field: AdditionalFieldConfig = {
      name: 'nickname',
      label: 'Nickname',
      type: 'string',
      defaultValue: 'Initial',
      validate,
      render: ({ value, onChange, onBlur, errors }) => (
        <>
          <input
            aria-label='Nickname'
            value={String(value)}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            onBlur={onBlur}
          />
          <span>{errors?.join(', ')}</span>
        </>
      ),
    };
    const { container } = render(
      <form>
        <AdditionalField name='nickname' field={field} />
      </form>,
    );
    const form = container.querySelector('form');
    if (!form) {
      throw new Error('Expected form');
    }
    expect(new FormData(form).get('nickname')).toBe('Initial');
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'invalid' } });
    expect(new FormData(form).get('nickname')).toBe('invalid');
    fireEvent.blur(screen.getByLabelText('Nickname'));
    await waitFor(() => {
      expect(screen.getByText('Choose another value')).toBeTruthy();
    });
    expect(validate).toHaveBeenCalledWith('invalid');
  });

  it.each([
    ['boolean', false, 'false'],
    ['number', 0, '0'],
    ['date', new Date('2026-10-01T00:00:00Z'), '2026-10-01T00:00:00.000Z'],
    ['date', new Date(''), ''],
    ['string', null, ''],
  ] as const)('preserves %s values and omits read-only fields from FormData', (type, defaultValue, expected) => {
    const field: AdditionalFieldConfig = { name: 'extra', label: 'Extra', type, defaultValue, render: () => null };
    const { container, rerender } = render(
      <form>
        <AdditionalField name='extra' field={field} />
      </form>,
    );
    const form = container.querySelector('form');
    if (!form) {
      throw new Error('Expected form');
    }
    expect(new FormData(form).get('extra')).toBe(expected);
    rerender(
      <form>
        <AdditionalField name='extra' field={{ ...field, readOnly: true }} />
      </form>,
    );
    expect(new FormData(form).has('extra')).toBe(false);
  });
});
