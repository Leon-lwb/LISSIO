import { describe, expect, it } from 'vitest';
import type { WidgetConfig } from '../../../types';
import { formatControlValue, snapControlValue, validateNumericRange } from '../numericControl';
import { widgetInputValue } from '../widgetValue';

const fixture = (kind: WidgetConfig['kind'], params: Record<string, unknown>) =>
  ({ kind, params } as unknown as WidgetConfig);

describe('numeric controls', () => {
  it('snaps relative to min without binary floating point residue', () => {
    expect(snapControlValue(0.35, { min: 0.1, max: 1, step: 0.1 })).toBe(0.4);
    expect(snapControlValue(10, { min: -1, max: 1, step: 0.25 })).toBe(1);
    expect(snapControlValue(-10, { min: -1, max: 1, step: 0.25 })).toBe(-1);
  });

  it('formats only meaningful decimals', () => {
    expect(formatControlValue(50, 0, 1)).toBe('50');
    expect(formatControlValue(1.5, 0, 0.1)).toBe('1.5');
    expect(formatControlValue(0.125, 0, 0.125)).toBe('0.125');
  });

  it('validates finite ordered ranges and positive steps', () => {
    expect(validateNumericRange({ min: 0, max: 1, step: 0.1 })).toBeNull();
    expect(validateNumericRange({ min: 1, max: 1, step: 1 })).toBe('range');
    expect(validateNumericRange({ min: 0, max: 1, step: 0 })).toBe('step');
  });
});

describe('input widget value semantics (widgetValue)', () => {
  it('radio value comes from the selected option', () => {
    const widget = fixture('Radio', {
      id: 'radio-1', label: 'Mode',
      options: [
        { id: 'radio-1-option-1', label: 'Low', value: 10 },
        { id: 'radio-1-option-2', label: 'High', value: 20 },
      ],
      selectedId: 'radio-1-option-2',
    });
    expect(widgetInputValue(widget)).toBe(20);
  });

  it('unchecked checkbox yields 0; selected options are summed', () => {
    const disabled = fixture('Checkbox', {
      id: 'check-1', label: 'Enable',
      options: [{ id: 'check-1-option-1', label: 'Option 1', value: 7 }],
      selectedIds: [],
    });
    expect(widgetInputValue(disabled)).toBe(0);

    const flags = fixture('Checkbox', {
      id: 'check-2', label: 'Flags',
      options: [
        { id: 'a', label: 'A', value: 1 },
        { id: 'b', label: 'B', value: 2 },
        { id: 'c', label: 'C', value: 4 },
      ],
      selectedIds: ['a', 'c'],
    });
    expect(widgetInputValue(flags)).toBe(5);
  });
});
