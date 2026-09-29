import { describe, expect, it } from 'vitest';
import { groupTurnSegments, splitTurnContent } from '../turnTimeline';
import type { AiToolRun } from '../../../types';

function run(id: string, textOffset: number): AiToolRun {
  return { id, name: 'read_file', arguments: {}, text_offset: textOffset, content: 'ok', is_error: false, done: true };
}

describe('splitTurnContent', () => {
  it('keeps text at its original position among tool groups', () => {
    const segments = splitTurnContent('先说明。再结论。', [run('a', 0), run('b', 4), run('c', 4)]);
    expect(segments.map((segment) => segment.kind)).toEqual(['tools', 'text', 'tools', 'text']);
    expect(segments[1]).toEqual({ kind: 'text', text: '先说明。' });
    expect(segments[2].kind === 'tools' && segments[2].tools.map((tool) => tool.id)).toEqual(['b', 'c']);
    expect(segments[3]).toEqual({ kind: 'text', text: '再结论。' });
  });

  it('uses UTF-16 offsets for emoji and clamps invalid positions', () => {
    expect(splitTurnContent('😀结果', [run('a', 2), run('b', 999)])).toEqual([
      { kind: 'text', text: '😀' },
      { kind: 'tools', offset: 2, tools: [run('a', 2)] },
      { kind: 'text', text: '结果' },
      { kind: 'tools', offset: 4, tools: [run('b', 999)] },
    ]);
  });

  it('keeps separate reasoning spans around a tool call', () => {
    const tool = run('a', 0);
    expect(splitTurnContent('答案', [tool], [
      { kind: 'reasoning', text: '先想' },
      { kind: 'tool', id: 'a' },
      { kind: 'reasoning', text: '再想' },
      { kind: 'text', text: '答案' },
    ])).toEqual([
      { kind: 'reasoning', text: '先想' },
      { kind: 'tools', offset: 0, tools: [tool] },
      { kind: 'reasoning', text: '再想' },
      { kind: 'text', text: '答案' },
    ]);
  });

  it('groups adjacent reasoning and tools into one process without changing their order', () => {
    const tool = run('a', 0);
    expect(groupTurnSegments([
      { kind: 'reasoning', text: '先想' },
      { kind: 'tools', offset: 0, tools: [tool] },
      { kind: 'reasoning', text: '再想' },
    ])).toEqual([{ kind: 'process', steps: [
      { kind: 'reasoning', text: '先想' },
      { kind: 'tool', run: tool },
      { kind: 'reasoning', text: '再想' },
    ] }]);
  });
});
