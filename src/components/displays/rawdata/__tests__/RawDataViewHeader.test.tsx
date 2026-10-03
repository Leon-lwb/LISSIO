import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithI18n } from '../../../../test/renderWithI18n';;
import { describe, expect, it, vi } from 'vitest';
import { RawDataViewHeader } from '../RawDataViewHeader';

function renderHeader(overrides: Partial<React.ComponentProps<typeof RawDataViewHeader>> = {}) {
  return renderWithI18n(
    <RawDataViewHeader
      grouping="grid"
      repr="hex"
      directionFilter="all"
      searchTerm=""
      channel="source"
      autoScroll
      showTimestamp
      showSettings={false}
      isNum={false}
      isStr={false}
      isFiltered={false}
      totalBytes={0}
      modeCount={0}
      droppedBytes={0}
      channelOptions={[{ key: 'source', sourceId: 'source', sourceHandle: 'rx' }]}
      connState={null}
      selectionCount={0}
      copyFeedback={false}
      detached={false}
      lang="zh"
      sourceLabel={() => 'source'}
      onGroupingChange={vi.fn()}
      onReprChange={vi.fn()}
      onDirectionFilterChange={vi.fn()}
      onSearchTermChange={vi.fn()}
      onChannelChange={vi.fn()}
      onAutoScrollChange={vi.fn()}
      onResetUserScroll={vi.fn()}
      onShowTimestampChange={vi.fn()}
      onShowSettingsChange={vi.fn()}
      onClear={vi.fn()}
      onClearSelection={vi.fn()}
      onCopySelected={vi.fn()}
      onDroppedInfoOpen={vi.fn()}
      {...overrides}
    />
  );
}

describe('RawDataViewHeader', () => {
  it('uses one decode dropdown containing all supported representations', () => {
    const onReprChange = vi.fn();
    renderHeader({ onReprChange });

    const decodeSelect = screen.getByRole('combobox', { name: '解码方式' });
    expect(within(decodeSelect).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'HEX',
      'ASCII',
      'UTF-8',
      'GBK',
    ]);

    fireEvent.change(decodeSelect, { target: { value: 'gbk' } });
    expect(onReprChange).toHaveBeenCalledWith('gbk');
    expect(screen.queryByRole('button', { name: 'UTF-8' })).toBeNull();
  });

  it('keeps the configuration toolbar on one horizontally scrollable line', () => {
    const { container } = renderHeader();
    const toolbar = container.querySelector('.rawdata-toolbar');

    expect(toolbar).toHaveClass('flex-nowrap');
    expect(toolbar).toHaveClass('overflow-x-auto');
    expect(toolbar).toHaveClass('overflow-y-hidden');
    expect(container.querySelector('.horizontal-scroll-shadow-start')).not.toBeNull();
    expect(container.querySelector('.horizontal-scroll-shadow-end')).not.toBeNull();
  });

  it('uses the shared responsive button base for direction and action labels', () => {
    renderHeader();

    const receive = screen.getByRole('button', { name: '接收' });
    expect(within(receive).getByText('接收')).toHaveClass('responsive-toolbar-label');

    const settings = screen.getByRole('button', { name: '设置' });
    expect(within(settings).getByText('设置')).toHaveClass('responsive-toolbar-label-wide');
  });

  it('disables byte representations while terminal decoding is active', () => {
    renderHeader({ grouping: 'terminal', repr: 'utf8' });

    const decodeSelect = screen.getByRole('combobox', { name: '解码方式' });
    expect(within(decodeSelect).getByRole('option', { name: 'HEX' })).toBeDisabled();
    expect(within(decodeSelect).getByRole('option', { name: 'ASCII' })).toBeDisabled();
    expect(within(decodeSelect).getByRole('option', { name: 'UTF-8' })).not.toBeDisabled();
    expect(within(decodeSelect).getByRole('option', { name: 'GBK' })).not.toBeDisabled();
  });
});
