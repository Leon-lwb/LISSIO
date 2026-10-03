import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithI18n } from '../../../test/renderWithI18n';;
import { AiMarkdown } from '../AiMarkdown';
import { tauriMock } from '../../../test/setup';

/// AI 回复 Markdown 渲染 — GFM / 代码高亮 / 无 HTML 注入 / 外链走系统浏览器

describe('AiMarkdown', () => {
  it('渲染标题 / 列表 / 表格 (GFM)', () => {
    renderWithI18n(<AiMarkdown text={'# 标题\n\n- 项目一\n\n| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(screen.getByRole('heading', { level: 1, name: '标题' })).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('代码块带语言标签与复制按钮', () => {
    renderWithI18n(<AiMarkdown text={'```rust\nfn main() {}\n```\n\n行内 `code` 文本'} />);
    expect(screen.getByText('rust')).toBeInTheDocument();
    expect(screen.getByTitle('复制')).toBeInTheDocument();
  });

  it('原始 HTML 不被注入 DOM (默认不渲染内联 HTML)', () => {
    const { container } = renderWithI18n(<AiMarkdown text={'<img src=x onerror="void 0" />'} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('链接点击经系统浏览器打开 (plugin-opener), 不在 webview 内导航', () => {
    renderWithI18n(<AiMarkdown text={'[官网](https://example.com)'} />);
    fireEvent.click(screen.getByText('官网'));
    expect(tauriMock.openUrl).toHaveBeenCalledWith('https://example.com');
  });

  // 折行契约: 面板内一列到底, 任何内容都不创建横向滚动容器
  it('代码块保留缩进但折行, 不横向滚动', () => {
    const long = `fn main() { let url = "https://example.com/${'segment/'.repeat(40)}"; }`;
    const { container } = renderWithI18n(<AiMarkdown text={`\`\`\`rust\n${long}\n\`\`\``} />);
    const pre = container.querySelector('pre');
    expect(pre).toHaveClass('whitespace-pre-wrap');
    expect(pre?.textContent).toContain('segment/');
    expect(pre).not.toHaveClass('overflow-x-auto');
  });

  it('表格按内容取宽且单元格折行, 不横向滚动', () => {
    const cell = 'https://example.com/' + 'x'.repeat(120);
    const { container } = renderWithI18n(<AiMarkdown text={`| 字段 | 值 |\n|---|---|\n| url | ${cell} |`} />);
    const table = container.querySelector('table');
    expect(table).toHaveClass('max-w-full');
    expect(table?.parentElement).not.toHaveClass('overflow-x-auto');
    expect(table?.querySelector('td')).toHaveClass('break-words');
    expect(table?.querySelector('th')).toHaveClass('align-top');
  });
});
