import { describe, expect, it } from 'vitest';
import { sessionFilename, sessionToMarkdown } from '../chatMarkdown';
import type { AiViewItem } from '../../../types';

const NOW = new Date('2026-09-12T14:30:00');

/// 会话 → Markdown 序列化 — 标准对话格式 (文件头 / 角色分节 / 工具摘要 / 错误警告 / 文件名净化)

describe('sessionToMarkdown', () => {
  it('空会话仅输出文件头 (标题 + 导出时间), 无角色分节', () => {
    const md = sessionToMarkdown('新会话', [], 'zh', NOW);
    expect(md).toContain('# 新会话');
    expect(md).toContain('导出时间:2026-09-12 14:30');
    expect(md).not.toContain('##');
  });

  it('用户与助手消息按角色分节, 原文 (含 Markdown) 保持', () => {
    const items: AiViewItem[] = [
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '# 回答\n\n- 要点一' },
    ];
    const md = sessionToMarkdown('调试', items, 'zh', NOW);
    expect(md.indexOf('## 🧑 用户')).toBeGreaterThan(-1);
    expect(md.indexOf('## 🧑 用户')).toBeLessThan(md.indexOf('## 🤖 助手'));
    expect(md).toContain('你好');
    expect(md).toContain('# 回答\n\n- 要点一');
  });

  it('助手条目的工具调用输出摘要行 (mcp 前缀缩短 + 本地化状态)', () => {
    const items: AiViewItem[] = [
      {
        role: 'assistant',
        text: '已完成',
        tools: [
          { id: '1', name: 'mcp_filesystem_read_file', arguments: {}, text_offset: 0, content: '', is_error: false, done: true },
          { id: '2', name: 'read_skill', arguments: {}, text_offset: 0, content: '', is_error: true, done: true },
          { id: '3', name: 'mcp_browser_web_search', arguments: {}, text_offset: 0, content: '', is_error: false, done: false },
        ],
      },
    ];
    const md = sessionToMarkdown('t', items, 'zh', NOW);
    expect(md).toContain('- 🔧 `read_file` 完成');
    expect(md).toContain('- 🔧 `read_skill` 失败');
    expect(md).toContain('- 🔧 `web_search` 调用中...');
  });

  it('无正文但有工具的助手条目只输出工具摘要', () => {
    const items: AiViewItem[] = [
      { role: 'assistant', text: '', tools: [
        { id: '1', name: 'plot', arguments: {}, text_offset: 0, content: '', is_error: false, done: true },
      ] },
    ];
    const md = sessionToMarkdown('t', items, 'zh', NOW);
    expect(md).toContain('## 🤖 助手');
    expect(md).toContain('- 🔧 `plot` 完成');
  });

  it('错误条目渲染为引用块警告 (按 kind 本地化, 不输出原文)', () => {
    const items: AiViewItem[] = [
      { role: 'assistant', text: 'raw', error: true, error_kind: 'AiCancelled' },
    ];
    const md = sessionToMarkdown('t', items, 'zh', NOW);
    expect(md).toContain('> ⚠️ 对话已取消');
    expect(md).not.toContain('raw');
  });

  it('用户条目的附件以标注标题 + 代码围栏完整保留', () => {
    const items: AiViewItem[] = [
      {
        role: 'user',
        text: '看看这个',
        attachments: [{ name: 'main.rs', content: 'fn main() {}' }],
      },
    ];
    const md = sessionToMarkdown('t', items, 'zh', NOW);
    expect(md).toContain('**附件: `main.rs`**');
    expect(md).toContain('```\nfn main() {}\n```');
    expect(md.indexOf('看看这个')).toBeLessThan(md.indexOf('main.rs'));
  });

  it('无正文仅附件的用户条目只输出附件块; 顺序在工具摘要之前', () => {
    const items: AiViewItem[] = [
      {
        role: 'user',
        text: '',
        attachments: [{ name: 'data.csv', content: 'a,b' }],
        tools: [
          { id: '1', name: 'plot', arguments: {}, text_offset: 0, content: '', is_error: false, done: true },
        ],
      },
    ];
    const md = sessionToMarkdown('t', items, 'zh', NOW);
    expect(md).toContain('**附件: `data.csv`**');
    expect(md.indexOf('附件: `data.csv`')).toBeLessThan(md.indexOf('- 🔧 `plot`'));
  });

  it('随界面语言切换分节标题 (en)', () => {
    const items: AiViewItem[] = [{ role: 'user', text: 'hi' }];
    const md = sessionToMarkdown('t', items, 'en', NOW);
    expect(md).toContain('## 🧑 User');
    expect(md).toContain('Exported at 2026-09-12 14:30');
  });
});

describe('sessionFilename', () => {
  it('会话名中的路径非法字符替换为下划线, 附分钟级时间戳', () => {
    expect(sessionFilename('调试:记录/1', NOW)).toBe('lissio-ai-调试_记录_1-20260912-1430');
  });

  it('空白会话名回退为 chat', () => {
    expect(sessionFilename('   ', NOW)).toBe('lissio-ai-chat-20260912-1430');
  });
});
