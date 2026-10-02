import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/appStore';
import { useAiChatStore } from '../../../store/aiChatStore';
import { AiChatPanel } from '../AiChatPanel';

vi.mock('../../../settings/aiProvider', () => ({ checkAiProviderSettings: () => null }));

const originalChatState = useAiChatStore.getState();
const send = vi.fn(() => Promise.resolve());
const noop = () => Promise.resolve();

beforeEach(() => {
  useAppStore.setState({ lang: 'zh' });
  send.mockClear();
  useAiChatStore.setState({
    activeSessionId: 'test-session',
    sessions: [{ id: 'test-session', title: '测试', created_at: 0, updated_at: 0, item_count: 0 }],
    viewItems: [],
    streaming: false,
    serverRunning: true,
    send,
    refreshSessions: noop,
    refreshTools: noop,
    refreshServerStatus: noop,
  });
});

afterEach(() => act(() => useAiChatStore.setState(originalChatState)));

describe('AiChatPanel composer', () => {
  it('does not send when Enter confirms an IME candidate, including the Enter after compositionend', () => {
    render(<AiChatPanel />);
    const composer = screen.getByRole('textbox', { name: /输入消息/ });
    fireEvent.change(composer, { target: { value: '你好' } });
    fireEvent.compositionStart(composer);
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });
    fireEvent.compositionEnd(composer);
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });

    expect(send).not.toHaveBeenCalled();
    expect(composer).toHaveValue('你好');

    const laterEnter = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
    Object.defineProperty(laterEnter, 'timeStamp', { value: Date.now() + 1000 });
    fireEvent(composer, laterEnter);
    expect(send).toHaveBeenCalledWith('你好', []);
  });

  it('sends on an ordinary Enter and keeps Shift+Enter for a newline', () => {
    render(<AiChatPanel />);
    const composer = screen.getByRole('textbox', { name: /输入消息/ });
    fireEvent.change(composer, { target: { value: '你好' } });
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter', keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(composer, { key: 'Enter', code: 'Enter' });
    expect(send).toHaveBeenCalledWith('你好', []);
  });

  // 折行契约: 长 URL/长 token 在面板宽度内折行, 气泡不撑出横向滚动
  it('用户消息气泡折行, 不依赖横向滚动', () => {
    useAiChatStore.setState({
      viewItems: [{ role: 'user', text: `https://example.com/${'segment-'.repeat(40)}` }],
    });
    const { container } = render(<AiChatPanel />);
    const text = container.querySelector('.whitespace-pre-wrap');
    expect(text).toHaveClass('[overflow-wrap:anywhere]');
    expect(text?.parentElement).toHaveClass('min-w-0');
    expect(container.textContent).toContain('segment-');
  });

  it('输入框在面板宽度内折行 (长 token 不产生横向滚动)', () => {
    render(<AiChatPanel />);
    const composer = screen.getByRole('textbox', { name: /输入消息/ });
    expect(composer).toHaveClass('[overflow-wrap:anywhere]');
    expect(composer).toHaveClass('overflow-y-auto');
    expect(composer).not.toHaveClass('overflow-x-auto');
  });
});
