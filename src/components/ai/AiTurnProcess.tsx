import { useEffect, useState } from 'react';
import { Think, ThoughtChain, XProvider, type ThoughtChainItemType } from '@ant-design/x';
import { BookOpen, BrainCircuit, Globe2, Pencil, Search, Terminal, Wrench } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { t, type Lang } from '../../i18n';
import { shortToolName } from '../../lib/ai/chatMarkdown';
import { toolActivityKind, type ActivityKind } from '../../lib/ai/activityKind';
import type { AiToolRun } from '../../types';
import type { ProcessStep } from '../../lib/ai/turnTimeline';

const blinkTokens = {
  colorTextBlink: 'var(--color-text-primary)',
  colorTextBlinkDefault: 'var(--color-text-secondary)',
};

const processTheme = {
  components: { Think: blinkTokens, ThoughtChain: blinkTokens },
};

function activityIcon(kind: ActivityKind) {
  switch (kind) {
    case 'read': return <BookOpen size={15} />;
    case 'edit': return <Pencil size={15} />;
    case 'command': return <Terminal size={15} />;
    case 'search': return <Search size={15} />;
    case 'web': return <Globe2 size={15} />;
    case 'tool': return <Wrench size={15} />;
  }
}

function formatDuration(ms: number, lang: Lang): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (lang === 'zh') return minutes ? `${minutes} 分钟 ${rest} 秒` : `${rest} 秒`;
  return minutes ? `${minutes} min ${rest} sec` : `${rest} sec`;
}

function useElapsedTime(streaming: boolean): number {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!streaming) return;
    const interval = window.setInterval(() => setElapsed(Date.now() - startedAt), 250);
    return () => window.clearInterval(interval);
  }, [startedAt, streaming]);
  return elapsed;
}

/** The duration belongs to the whole assistant turn, not each activity group. */
export function AiTurnDuration({ durationMs, streaming }: { durationMs?: number; streaming: boolean }) {
  const lang = useAppStore((s) => s.lang);
  const elapsed = useElapsedTime(streaming);
  if (!streaming && durationMs == null) return null;
  const title = t(lang, streaming ? 'aiRunningFor' : 'aiElapsed')
    .replace('{time}', formatDuration(streaming ? elapsed : durationMs ?? 0, lang));
  return <div className="flex items-center gap-1.5 text-xs text-text-secondary">{title}</div>;
}

function ReasoningStep({ reasoning, streaming }: { reasoning?: string; streaming: boolean }) {
  const lang = useAppStore((s) => s.lang);
  const [expanded, setExpanded] = useState(streaming);
  const label = t(lang, streaming ? 'aiThinking' : 'aiReasoning');
  return (
    <Think
      title={<button type="button" aria-label={label} aria-expanded={expanded} className="text-left">{label}</button>}
      icon={<BrainCircuit size={15} />}
      blink={streaming}
      expanded={expanded}
      onExpand={setExpanded}
      className="min-w-0"
      classNames={{
        status: 'text-text-secondary!',
        // 思考过程只限高, 长句/长 token 在面板宽度内折行 (不出现横向滚动)
        content: 'max-h-72 overflow-y-auto overflow-x-hidden whitespace-pre-wrap [overflow-wrap:anywhere] text-text-secondary!',
      }}
    >
      {reasoning?.trim() ? reasoning : streaming ? '…' : ''}
    </Think>
  );
}

function toolItem(run: AiToolRun, expanded: boolean, lang: Lang): ThoughtChainItemType {
  const name = shortToolName(run.name);
  const kind = toolActivityKind(run.name);
  const status = !run.done ? 'running' : run.is_error ? 'error' : 'done';
  const kindKey = kind.charAt(0).toUpperCase() + kind.slice(1);
  const statusKey = status.charAt(0).toUpperCase() + status.slice(1);
  const label = t(lang, `aiActivity${kindKey}${statusKey}`).replace('{name}', name);

  return {
    key: run.id,
    icon: activityIcon(kind),
    blink: !run.done,
    collapsible: true,
    title: <button type="button" aria-label={label} aria-expanded={expanded} className="text-left">{label}</button>,
    content: (
      <div className="min-w-0 space-y-1 text-xs">
        <div>{t(lang, 'aiToolInput')}</div>
        <pre className="max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap [overflow-wrap:anywhere]">
          {JSON.stringify(run.arguments, null, 2)}
        </pre>
        {run.content && (
          <>
            <div>{t(lang, 'aiToolOutput')}</div>
            <pre className="max-h-64 overflow-y-auto overflow-x-hidden whitespace-pre-wrap [overflow-wrap:anywhere]">
              {run.content}
            </pre>
          </>
        )}
      </div>
    ),
  };
}

/** Component-driven activity log for one assistant turn. */
export function AiTurnProcess({
  steps = [],
  streaming = false,
}: {
  steps?: ProcessStep[];
  streaming?: boolean;
}) {
  const lang = useAppStore((s) => s.lang);
  const [expanded, setExpanded] = useState(streaming);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  useEffect(() => setExpanded(streaming), [streaming]);
  const isWorking = streaming && steps.some((step) => step.kind === 'tool' && !step.run.done);
  const last = steps[steps.length - 1];
  const showWaiting = streaming && (!last || (last.kind === 'tool' && last.run.done));

  if (steps.length === 0 && !streaming) return null;

  const items: ThoughtChainItemType[] = steps.map((step, index) => step.kind === 'reasoning'
    ? {
      key: `reasoning-${index}`,
      icon: false,
      title: <ReasoningStep reasoning={step.text} streaming={streaming && index === steps.length - 1} />,
    }
    : toolItem(step.run, expandedKeys.includes(step.run.id), lang));
  if (showWaiting) items.push({
    key: 'waiting',
    icon: false,
    title: <ReasoningStep streaming />,
  });

  return (
    <XProvider theme={processTheme}>
      <Think
        title={<button type="button" aria-label={t(lang, 'aiViewProcess')} aria-expanded={expanded} className="text-left">
          {t(lang, 'aiViewProcess')}
          {streaming && ` · ${t(lang, isWorking ? 'aiUsingTools' : 'aiThinking')}`}
        </button>}
        blink={streaming}
        expanded={expanded}
        onExpand={setExpanded}
        className="ai-activity min-w-0 max-w-full text-xs"
        classNames={{
          status: 'text-text-secondary!',
          // Think 内容区固定 width:100%, 面板变窄时需可收缩
          content: 'min-w-0 text-text-secondary!',
        }}
      >
        <ThoughtChain
          items={items}
          expandedKeys={expandedKeys}
          onExpand={setExpandedKeys}
          className="min-w-0 text-text-secondary!"
          // itemHeader/itemContent 是 flex 后代: min-w-0 让长标题/长 JSON 参与收缩
          classNames={{
            itemHeader: 'min-w-0 text-text-secondary!',
            itemContent: 'min-w-0 text-text-secondary!',
          }}
        />
      </Think>
    </XProvider>
  );
}
