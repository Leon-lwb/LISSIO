import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAppStore } from '../../../store/appStore';
import { toolActivityKind } from '../../../lib/ai/activityKind';
import { AiTurnProcess } from '../AiTurnProcess';

describe('AiTurnProcess', () => {
  it('shows a compact summary and exposes reasoning and tool details on demand', () => {
    useAppStore.setState({ lang: 'en' });
    const { container } = render(
      <AiTurnProcess
        steps={[
          { kind: 'reasoning', text: 'Checked the device state.' },
          { kind: 'tool', run: {
            id: 'call-1',
            name: 'mcp_local_read_status',
            arguments: { device: 'sensor' },
            text_offset: 0,
            content: 'ready',
            is_error: false,
            done: true,
          } },
        ]}
      />
    );

    const summary = screen.getByRole('button', { name: 'View process' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    const reasoning = screen.getByRole('button', { name: 'Reasoning' });
    const read = screen.getByRole('button', { name: 'Read read_status' });
    expect(container.querySelector('.lucide-book-open')).toBeInTheDocument();
    expect(container.querySelector('.anticon-check-circle, .anticon-close-circle, .anticon-loading')).not.toBeInTheDocument();
    expect(reasoning).toHaveAttribute('aria-expanded', 'false');
    expect(read).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(reasoning);
    expect(screen.getByText('Checked the device state.')).toBeInTheDocument();
    fireEvent.click(read);
    expect(screen.getByText(/"device": "sensor"/)).toBeInTheDocument();
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('updates a running tool row to its completed state', () => {
    useAppStore.setState({ lang: 'en' });
    const run = {
      id: 'call-2',
      name: 'mcp_local_get_workspace',
      arguments: {},
      text_offset: 0,
      content: '',
      is_error: false,
      done: false,
    };
    const { container, rerender } = render(<AiTurnProcess steps={[{ kind: 'tool', run }]} streaming />);
    expect(screen.getByRole('button', { name: 'Reading get_workspace' })).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('.ant-thought-chain-motion-blink')).toBeInTheDocument();
    expect(container.querySelector('.ant-think-motion-blink')).toBeInTheDocument();
    expect(container.querySelector('.lucide-book-open')).toBeInTheDocument();
    expect(container.querySelector('.anticon-loading')).not.toBeInTheDocument();
    const themeStyles = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '');
    expect(themeStyles.some((css) => css.includes('--ant-think-color-text-blink:var(--color-text-primary)')
      && css.includes('--ant-think-color-text-blink-default:var(--color-text-secondary)'))).toBe(true);
    expect(themeStyles.some((css) => css.includes('--ant-thought-chain-color-text-blink:var(--color-text-primary)')
      && css.includes('--ant-thought-chain-color-text-blink-default:var(--color-text-secondary)'))).toBe(true);
    rerender(<AiTurnProcess steps={[{ kind: 'tool', run: { ...run, content: 'ready', done: true } }]} />);
    expect(screen.getByRole('button', { name: 'View process' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'View process' }));
    expect(container.querySelector('.ant-thought-chain-motion-blink')).not.toBeInTheDocument();
    expect(container.querySelector('.lucide-book-open')).toBeInTheDocument();
    expect(container.querySelector('.anticon-check-circle')).not.toBeInTheDocument();
  });

  it('keeps the tool icon when a call fails', () => {
    useAppStore.setState({ lang: 'en' });
    const { container } = render(<AiTurnProcess steps={[{ kind: 'tool', run: {
      id: 'failed', name: 'mcp_local_read_status', arguments: {}, text_offset: 0,
      content: 'error', is_error: true, done: true,
    } }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'View process' }));
    expect(container.querySelector('.lucide-book-open')).toBeInTheDocument();
    expect(container.querySelector('.anticon-close-circle')).not.toBeInTheDocument();
  });

  it('classifies tool actions before choosing their icons', () => {
    expect(toolActivityKind('get_workspace')).toBe('read');
    expect(toolActivityKind('update_graph')).toBe('edit');
    expect(toolActivityKind('run_workspace')).toBe('command');
    expect(toolActivityKind('query_recording_sql')).toBe('search');
    expect(toolActivityKind('mcp_browser_open')).toBe('web');
    expect(toolActivityKind('mcp_local_probe')).toBe('tool');
  });

  // 折行契约: 思考文本与工具 JSON 只纵向限高, 长 token 折行而非横向滚动
  it('wraps reasoning text and tool JSON instead of scrolling horizontally', () => {
    useAppStore.setState({ lang: 'en' });
    const long = `https://example.com/${'segment-'.repeat(40)}`;
    const { container } = render(
      <AiTurnProcess
        steps={[
          { kind: 'reasoning', text: long },
          { kind: 'tool', run: {
            id: 'call-wrap',
            name: 'mcp_local_read_status',
            arguments: { url: long },
            text_offset: 0,
            content: long,
            is_error: false,
            done: true,
          } },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'View process' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reasoning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read read_status' }));

    const pres = Array.from(container.querySelectorAll('pre'));
    expect(pres).toHaveLength(2);
    for (const pre of pres) {
      expect(pre).toHaveClass('whitespace-pre-wrap', '[overflow-wrap:anywhere]');
      expect(pre).not.toHaveClass('overflow-auto', 'overflow-x-auto');
    }
    expect(container.querySelector('.ant-think-content.overflow-x-hidden')).toBeInTheDocument();
  });
});
