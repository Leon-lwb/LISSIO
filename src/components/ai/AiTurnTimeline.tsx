import { groupTurnSegments, splitTurnContent } from '../../lib/ai/turnTimeline';
import type { AiToolRun, AiTurnEvent } from '../../types';
import { AiMarkdown } from './AiMarkdown';
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
        if (segment.kind === 'text') return <AiMarkdown key={`text-${index}`} text={segment.text} />;
        return <AiTurnProcess key={`process-${index}`} steps={segment.steps} streaming={streaming && index === displaySegments.length - 1} />;
      })}
      {showInitialWaiting && <AiTurnProcess streaming />}
    </div>
  );
}
