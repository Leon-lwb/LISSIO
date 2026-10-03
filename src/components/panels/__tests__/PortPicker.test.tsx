import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';;
import { useAppStore } from '../../../store/appStore';
import { PortPicker } from '../PortPicker';
import type { PortInfo } from '../../../types';

const basePort: PortInfo = {
  name: 'COM3',
  port_type: 'USB',
  vid: 0x1a86,
  pid: 0x7523,
  serial_number: 'A1B2C3',
  manufacturer: 'wch.cn',
  product: 'USB-SERIAL CH340',
  description: null,
};

describe('PortPicker', () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState({ lang: 'en' });
    });
  });

  afterEach(() => {
    act(() => {
      useAppStore.setState({ ports: [] });
    });
  });

  it('renders the Windows device manager description when present and different from product', () => {
    act(() => {
      useAppStore.setState({
        ports: [{ ...basePort, description: 'USB-SERIAL CH340 (COM3)' }],
      });
    });

    renderWithI18n(<PortPicker selectedPortName="" onSelect={() => { return undefined; }} />);

    expect(screen.getByText('USB-SERIAL CH340 (COM3)')).toBeInTheDocument();
    expect(screen.getByText(/USB-SERIAL CH340 · wch\.cn/)).toBeInTheDocument();
    expect(screen.getByText(/VID 1A86/)).toBeInTheDocument();
    expect(screen.getByText(/PID 7523/)).toBeInTheDocument();
    expect(screen.getByText(/S\/N A1B2C3/)).toBeInTheDocument();
  });

  it('does not repeat description when it equals product', () => {
    act(() => {
      useAppStore.setState({
        ports: [{ ...basePort, description: 'USB-SERIAL CH340' }],
      });
    });

    renderWithI18n(<PortPicker selectedPortName="" onSelect={() => { return undefined; }} />);

    // product 行渲染一次，description 行因与 product 相同被去重不渲染
    expect(screen.getAllByText(/USB-SERIAL CH340/).length).toBe(1);
  });

  it('does not render a description line when description is null', () => {
    act(() => {
      useAppStore.setState({
        ports: [{ ...basePort, description: null }],
      });
    });

    renderWithI18n(<PortPicker selectedPortName="" onSelect={() => { return undefined; }} />);

    expect(screen.queryByText('USB-SERIAL CH340 (COM3)')).not.toBeInTheDocument();
    expect(screen.getByText(/USB-SERIAL CH340 · wch\.cn/)).toBeInTheDocument();
  });

  it('filters ports by description text', () => {
    act(() => {
      useAppStore.setState({
        ports: [
          { ...basePort, name: 'COM3', description: 'STM32 STLink' },
          { ...basePort, name: 'COM4', description: 'CP2102 USB to UART' },
        ],
      });
    });

    renderWithI18n(<PortPicker selectedPortName="" onSelect={() => { return undefined; }} />);
    const input = screen.getByPlaceholderText(/Filter ports/i);
    fireEvent.change(input, { target: { value: 'stlink' } });

    expect(screen.getByText('COM3')).toBeInTheDocument();
    expect(screen.queryByText('COM4')).not.toBeInTheDocument();
  });
});
