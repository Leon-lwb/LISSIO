import { groupTurnSegments, splitTurnContent } from '../../lib/ai/turnTimeline';
import type { AiToolRun, AiTurnEvent } from '../../types';
import { AiMarkdown, AiStreamingMarkdown } from './AiMarkdown';
import { AiTurnDuration, AiTurnProcess } from './AiTurnProcess';

/** Render text and tool activity in their original stream order. */
export function AiTurnTimeline({
  text,
  reasoning,
  tools = [],
  timeline,
  durationMs,
  streaming = false,
}: {
  text: string;
  reasoning?: string;
  tools?: AiToolRun[];
  timeline?: AiTurnEvent[];
  durationMs?: number;
  streaming?: boolean;
}) {
  const segments = splitTurnContent(text, tools, timeline);
  const orderedSegments = timeline ? segments : [
    ...(reasoning?.trim() ? [{ kind: 'reasoning' as const, text: reasoning }] : []),
    ...segments,
  ];
  const displaySegments = groupTurnSegments(orderedSegments);
  const showInitialWaiting = streaming && displaySegments.length === 0;

  return (
    <div className="min-w-0 space-y-2">
      <AiTurnDuration durationMs={durationMs} streaming={streaming} />
      {displaySegments.map((segment, index) => {
        const isLast = index === displaySegments.length - 1;
        if (segment.kind === 'text') {
          // 只有正在增长的最后一段走增量渲染; 已被工具调用/后续文本截断的段是定稿内容
          return streaming && isLast
            ? <AiStreamingMarkdown key={`text-${index}`} text={segment.text} />
            : <AiMarkdown key={`text-${index}`} text={segment.text} />;
        }
        return <AiTurnProcess key={`process-${index}`} steps={segment.steps} streaming={streaming && isLast} />;
      })}
      {showInitialWaiting && <AiTurnProcess streaming />}
    </div>
  );
}
