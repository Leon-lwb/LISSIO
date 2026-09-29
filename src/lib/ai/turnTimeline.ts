import type { AiToolRun, AiTurnEvent } from '../../types';

export type TurnSegment =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'tools'; offset: number; tools: AiToolRun[] };

export type ProcessStep =
  | { kind: 'reasoning'; text: string }
  | { kind: 'tool'; run: AiToolRun };

export type DisplaySegment =
  | { kind: 'text'; text: string }
  | { kind: 'process'; steps: ProcessStep[] };

/** Adjacent thinking and tool activity share one process in event order. */
export function groupTurnSegments(segments: TurnSegment[]): DisplaySegment[] {
  const grouped: DisplaySegment[] = [];
  for (const segment of segments) {
    if (segment.kind === 'text') {
      grouped.push(segment);
      continue;
    }
    const steps: ProcessStep[] = segment.kind === 'reasoning'
      ? [{ kind: 'reasoning', text: segment.text }]
      : segment.tools.map((run) => ({ kind: 'tool', run }));
    const last = grouped[grouped.length - 1];
    if (last?.kind === 'process') last.steps.push(...steps);
    else grouped.push({ kind: 'process', steps });
  }
  return grouped;
}

/** Rebuild the event order without splitting the persisted assistant turn. */
export function splitTurnContent(text: string, tools: AiToolRun[], timeline?: AiTurnEvent[]): TurnSegment[] {
  if (timeline) {
    const byId = new Map(tools.map((run) => [run.id, run]));
    const ordered: TurnSegment[] = [];
    let offset = 0;
    for (const event of timeline) {
      if (event.kind === 'text') {
        if (event.text) ordered.push({ kind: 'text', text: event.text });
        offset += event.text.length;
      } else if (event.kind === 'reasoning') {
        if (event.text) ordered.push({ kind: 'reasoning', text: event.text });
      } else {
        const run = byId.get(event.id);
        if (!run) continue;
        const last = ordered[ordered.length - 1];
        if (last?.kind === 'tools') last.tools.push(run);
        else ordered.push({ kind: 'tools', offset, tools: [run] });
      }
    }
    return ordered;
  }
  const segments: TurnSegment[] = [];
  let cursor = 0;
  for (const run of tools) {
    const offset = Math.max(cursor, Math.min(text.length, run.text_offset));
    if (offset > cursor) {
      segments.push({ kind: 'text', text: text.slice(cursor, offset) });
      cursor = offset;
    }
    const previous = segments[segments.length - 1];
    if (previous?.kind === 'tools' && previous.offset === offset) {
      previous.tools.push(run);
    } else {
      segments.push({ kind: 'tools', offset, tools: [run] });
    }
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}
