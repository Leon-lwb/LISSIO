import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DiscoveredEndpoint } from '../../../types';
import { DiscoveredEndpointList } from '../DiscoveredEndpointList';

const endpoints: DiscoveredEndpoint[] = [
  {
    adapterId: 'serial',
    discoveryId: '/dev/ttyUSB0',
    displayName: 'USB Serial Port',
    configurationPatch: { port_name: '/dev/ttyUSB0' },
    metadata: {},
  },
  {
    adapterId: 'serial',
    discoveryId: '/dev/ttyUSB1',
    displayName: '/dev/ttyUSB1',
    configurationPatch: { port_name: '/dev/ttyUSB1' },
    metadata: {},
  },
];

function renderList(overrides: Partial<Parameters<typeof DiscoveredEndpointList>[0]> = {}) {
  const props = {
    endpoints,
    payload: {} as Record<string, unknown>,
    pending: false,
    disabled: false,
    onRefresh: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  render(<DiscoveredEndpointList {...props} />);
  return props;
}

describe('DiscoveredEndpointList', () => {
  it('renders a card per endpoint with display name and discovery id', () => {
    renderList();
    expect(screen.getByText('USB Serial Port')).toBeInTheDocument();
    expect(screen.getByText('/dev/ttyUSB0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '/dev/ttyUSB1' })).toBeInTheDocument();
  });

  it('calls onSelect with the clicked endpoint', () => {
    const props = renderList();
    fireEvent.click(screen.getByText('USB Serial Port'));
    expect(props.onSelect).toHaveBeenCalledWith(endpoints[0]);
  });

  it('marks the endpoint whose patch matches the payload as pressed', () => {
    renderList({ payload: { port_name: '/dev/ttyUSB1' } });
    expect(screen.getByRole('button', { name: '/dev/ttyUSB1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /USB Serial Port/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the empty state when nothing was discovered', () => {
    renderList({ endpoints: [] });
    expect(screen.getByText('未发现设备')).toBeInTheDocument();
  });

  it('shows the loading state while the first discovery runs', () => {
    renderList({ endpoints: [], pending: true });
    expect(screen.getByText('发现中…')).toBeInTheDocument();
  });

  it('keeps cards visible when refreshing with existing results', () => {
    renderList({ pending: true });
    expect(screen.getByText('USB Serial Port')).toBeInTheDocument();
  });

  it('calls onRefresh from the refresh button', () => {
    const props = renderList();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it('does not call onSelect while disabled', () => {
    const props = renderList({ disabled: true });
    fireEvent.click(screen.getByText('USB Serial Port'));
    expect(props.onSelect).not.toHaveBeenCalled();
  });

  it('renders manufacturer, vid:pid and serial number from metadata', () => {
    renderList({
      endpoints: [{
        ...endpoints[0],
        metadata: { vid: 0x1a86, pid: 0x7523, serialNumber: 'ABC123', manufacturer: 'wch.cn' },
      }],
    });
    expect(screen.getByText('wch.cn')).toBeInTheDocument();
    expect(screen.getByText('1A86:7523')).toBeInTheDocument();
    expect(screen.getByText(/ABC123/)).toBeInTheDocument();
  });

  it('omits hardware details when metadata is empty', () => {
    renderList({ endpoints: [endpoints[0]] });
    expect(screen.queryByText(/\d{4}:\d{4}/)).not.toBeInTheDocument();
  });
});
