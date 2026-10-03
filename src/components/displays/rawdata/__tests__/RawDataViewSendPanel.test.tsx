import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithI18n } from '../../../../test/renderWithI18n';;
import { describe, expect, it, vi } from 'vitest';
import { RawDataViewSendPanel } from '../RawDataViewSendPanel';

describe('RawDataViewSendPanel', () => {
  it('shows and updates the selected append option', () => {
    const onAppendModeChange = vi.fn();
    const { rerender } = renderWithI18n(
      <RawDataViewSendPanel
        appendMode="nl"
        sendContent=""
        onAppendModeChange={onAppendModeChange}
        onSendContentChange={vi.fn()}
        onSend={vi.fn()}
        lang="en"
        targetTransportLabel="Serial"
      />
    );

    const none = screen.getByRole('button', { name: 'None' });
    const newline = screen.getByRole('button', { name: '\\n' });
    expect(newline).toHaveAttribute('aria-pressed', 'true');
    expect(newline).toHaveClass('bg-accent');
    expect(newline).not.toHaveClass('bg-bg-input');

    fireEvent.click(none);
    expect(onAppendModeChange).toHaveBeenCalledWith('none');

    rerender(
      <RawDataViewSendPanel
        appendMode="none"
        sendContent=""
        onAppendModeChange={onAppendModeChange}
        onSendContentChange={vi.fn()}
        onSend={vi.fn()}
        lang="en"
        targetTransportLabel="Serial"
      />
    );
    expect(none).toHaveAttribute('aria-pressed', 'true');
    expect(newline).toHaveAttribute('aria-pressed', 'false');
  });

  it('uses responsive text on the shared send button and keeps the bottom bar scrollable', () => {
    const { container } = renderWithI18n(
      <RawDataViewSendPanel
        appendMode="none"
        sendContent=""
        onAppendModeChange={vi.fn()}
        onSendContentChange={vi.fn()}
        onSend={vi.fn()}
        lang="zh"
        targetTransportLabel="Serial"
      />
    );

    const send = screen.getByRole('button', { name: '发送' });
    expect(within(send).getByText('发送')).toHaveClass('responsive-toolbar-label-compact');
    const toolbar = container.querySelector('.responsive-toolbar');
    expect(toolbar).toHaveClass('overflow-x-auto');
    expect(toolbar).toHaveClass('flex-nowrap');
    expect(container.querySelector('.horizontal-scroll-shadow-end')).not.toBeNull();
  });
});
