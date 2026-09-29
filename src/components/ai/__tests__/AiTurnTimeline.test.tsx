import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAppStore } from '../../../store/appStore';
import { AiTurnTimeline } from '../AiTurnTimeline';

describe('AiTurnTimeline', () => {
  it('renders a completed tool group between the text chunks and folds it', () => {
    useAppStore.setState({ lang: 'zh' });
    const { container } = render(
      <AiTurnTimeline
        text="先检查。再回答。"
        tools={[{
          id: 'call-1', name: 'get_workspace', arguments: {}, text_offset: 4,
          content: '{}', is_error: false, done: true,
        }]}
      />
    );
    const text = container.textContent ?? '';
    expect(text.indexOf('先检查。')).toBeLessThan(text.indexOf('查看过程'));
    expect(text.indexOf('查看过程')).toBeLessThan(text.indexOf('再回答。'));
    expect(screen.getByRole('button', { name: '查看过程' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps an executing tool group open with running animation state', () => {
    useAppStore.setState({ lang: 'zh' });
    const { container } = render(
      <AiTurnTimeline
        text=""
        streaming
        tools={[{
          id: 'call-1', name: 'get_workspace', arguments: {}, text_offset: 0,
          content: '', is_error: false, done: false,
        }]}
      />
    );
    expect(screen.getByRole('button', { name: '查看过程' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '正在读取 get_workspace' })).toBeInTheDocument();
    expect(container.querySelector('.ant-thought-chain')).toBeInTheDocument();
  });

  it('shows an active waiting row before any output arrives', () => {
    useAppStore.setState({ lang: 'zh' });
    const { container } = render(<AiTurnTimeline text="" timeline={[]} streaming />);
    expect(screen.getByText(/已运行|运行中/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看过程' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '正在思考' })).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-think-motion-blink')).toHaveLength(2);
    expect(container.querySelector('.anticon-loading')).not.toBeInTheDocument();
  });

  it('keeps reasoning, tools and output in event order with one duration at the top', () => {
    useAppStore.setState({ lang: 'zh' });
    const { container } = render(
      <AiTurnTimeline
        text="先说明。最终回答。"
        reasoning="检查先检查后"
        durationMs={3000}
        tools={[{
          id: 'call-1', name: 'get_workspace', arguments: {}, text_offset: 4,
          content: '{}', is_error: false, done: true,
        }]}
        timeline={[
          { kind: 'reasoning', text: '检查先' },
          { kind: 'text', text: '先说明。' },
          { kind: 'tool', id: 'call-1' },
          { kind: 'reasoning', text: '检查后' },
          { kind: 'text', text: '最终回答。' },
        ]}
      />
    );
    const children = Array.from(container.firstElementChild?.children ?? []);
    expect(children[0]).toHaveTextContent('用时 3 秒');
    expect(children[1]).toHaveClass('ai-activity');
    expect(children[2]).toHaveTextContent('先说明。');
    expect(children[3]).toHaveClass('ai-activity');
    expect(children[4]).toHaveTextContent('最终回答。');
    expect(screen.getByText('用时 3 秒')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '查看过程' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '查看过程' })[1]);
    expect(children[3].querySelectorAll('.ant-thought-chain-node')).toHaveLength(2);
  });
});
