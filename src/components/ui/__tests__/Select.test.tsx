import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Select } from '../Select';

const options = [
  { value: 'modbus-rtu', label: 'Modbus RTU' },
  { value: 'modbus-tcp', label: 'Modbus TCP', disabled: true },
  { value: 'serial', label: 'Serial' },
  { value: 'slcan', label: 'Slcan' },
];

function Picker({ onChange = () => undefined }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('modbus-rtu');
  return <><Select label="Add device" options={options} value={value}
    onChange={next => { setValue(next); onChange(next); }} /><button>Next</button></>;
}

describe('Select', () => {
  it('renders options in the app portal and commits a pointer choice', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const { container } = render(<Picker onChange={changed} />);
    const trigger = screen.getByRole('combobox', { name: 'Add device' });
    await user.click(trigger);
    expect(container.querySelector('select')).toBeNull();
    expect(container.contains(screen.getByRole('listbox'))).toBe(false);
    await user.click(screen.getByRole('option', { name: 'Serial' }));
    expect(changed).toHaveBeenCalledExactlyOnceWith('serial');
    expect(trigger).toHaveTextContent('Serial');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('navigates enabled choices, cancels with Escape, and commits with Enter', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Picker onChange={changed} />);
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Serial' }).id);
    await user.keyboard('{Escape}');
    expect(changed).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent('Modbus RTU');
    await user.keyboard('{ArrowDown}{End}{Home}{ArrowDown}{Enter}');
    expect(changed).toHaveBeenCalledExactlyOnceWith('serial');
  });

  it('supports typeahead, repeated-letter cycling, and Tab focus movement', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    await user.keyboard('ss');
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Slcan' }).id);
    await user.tab();
    expect(trigger).toHaveTextContent('Slcan');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('dismisses outside and never chooses disabled or empty options', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const { rerender } = render(<Select label="Add device" value="modbus-rtu" options={options} onChange={changed} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Modbus TCP' }));
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    rerender(<Select label="Add device" value="" options={[]} onChange={changed} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('drops stale active options when discovery changes while open', async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const { rerender } = render(<Select label="Add device" value="modbus-rtu" options={options} onChange={changed} />);
    await user.click(screen.getByRole('combobox'));
    await user.keyboard('{End}');
    rerender(<Select label="Add device" value="serial" options={[options[2]]} onChange={changed} />);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', screen.getByRole('option').id);
    await user.keyboard('{Enter}');
    expect(changed).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
