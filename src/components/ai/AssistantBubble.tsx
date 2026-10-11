import { memo, useState, type CSSProperties } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { formatAiKindError } from '../../lib/ai/aiErrors';
import { translate } from '../../i18n';
import { writeTextToClipboard } from '../../lib/utils/clipboard';
import { AiTurnTimeline } from './AiTurnTimeline';
import type { AiViewItem } from '../../types';

/// 助手消息气泡 — Markdown 渲染 + 悬停操作 (复制 / 错误重试)
///
/// memo 化: 流式回合刷新的是活跃尾块, 历史条目引用不变时必须跳过重建 —
/// 否则每个 token 都会把整张消息列表重新渲染一遍 (长会话下直接拖垮渲染进程)。
/// staggerStyle 因此也要保持引用稳定: 调用方用模块级常量传进来, 不破坏 memo。
export const AssistantBubble = memo(function AssistantBubble({
  item,
  canRetry,
  staggerStyle,
}: {
  item: AiViewItem;
  canRetry: boolean;
  /** 同一批挂载的气泡按索引错峰 — 见 lib/motion/stagger.ts */
  staggerStyle?: CSSProperties;
}) {
  const lang = useAppStore((s) => s.lang);
  const regenerate = useAiChatStore((s) => s.regenerate);
  const [copied, setCopied] = useState(false);
  const hasText = item.text.length > 0;
  // 错误条目: 按 kind 本地化为主行, 后端原始描述降级为次要信息 (排查用)
  const errView = item.error
    ? formatAiKindError(item.error_kind ?? '', item.error_data, item.text, lang)
    : null;

  const onCopy = async () => {
    if (await writeTextToClipboard(item.text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  return (
    <div className="flex justify-start group motion-message-in ai-assistant-message" style={staggerStyle}>
      <div
        className={`max-w-full min-w-0 w-full px-1 py-1 space-y-2 ${
          item.error ? 'text-danger' : ''
        }`}
      >
        {errView ? (
          <>
            <div className="break-words [overflow-wrap:anywhere]">{errView.summary}</div>
            {errView.detail && (
              <div className="break-words [overflow-wrap:anywhere] opacity-secondary line-clamp-3">{errView.detail}</div>
            )}
          </>
        ) : <AiTurnTimeline text={item.text} reasoning={item.reasoning} tools={item.tools} timeline={item.timeline} durationMs={item.duration_ms} />}
        {/* 悬停操作条 — 复制原文 / 错误条目重试 (仅最后一条可重试, 与后端 truncate 语义一致) */}
        <div
          className={`flex items-center gap-0.5 -mb-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${
            item.error ? 'justify-end' : ''
          }`}
        >
          {hasText && (
            <button
              className="p-0.5 rounded text-text-secondary hover:text-text-primary"
              onClick={() => void onCopy()}
              title={translate('aiCopy', lang)}
            >
              {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
            </button>
          )}
          {item.error && canRetry && (
            <button
              className="p-0.5 rounded text-text-secondary hover:text-text-primary disabled:opacity-disabled"
              onClick={() => void regenerate()}
              disabled={!canRetry}
              title={translate('aiRetry', lang)}
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

/// 会话下拉 — 列表 (最近活动优先) / 新建 / 行内重命名 / 删除
