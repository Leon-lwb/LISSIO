import { describe, expect, it } from 'vitest';
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_CHARS,
  filterAttachmentCandidates,
} from '../attachments';
import type { AiAttachment } from '../../../types';

const att = (name: string): AiAttachment => ({ name, content: 'x' });

describe('filterAttachmentCandidates', () => {
  it('accepts whitelisted text extensions', () => {
    const r = filterAttachmentCandidates(
      [
        { name: 'a.md', size: 10 },
        { name: 'data.CSV', size: 10 },
        { name: 'main.rs', size: 10 },
      ],
      []
    );
    expect(r.accepted.map((c) => c.name)).toEqual(['a.md', 'data.CSV', 'main.rs']);
    expect(r.rejections.unsupported).toEqual([]);
  });

  it('rejects unknown extensions and extensionless names', () => {
    const r = filterAttachmentCandidates(
      [
        { name: 'app.exe', size: 10 },
        { name: 'README', size: 10 },
        { name: 'photo.jpeg', size: 10 },
      ],
      []
    );
    expect(r.accepted).toEqual([]);
    expect(r.rejections.unsupported).toEqual(['app.exe', 'README', 'photo.jpeg']);
  });

  it('rejects oversized files by byte size', () => {
    const r = filterAttachmentCandidates(
      [
        { name: 'big.log', size: MAX_ATTACHMENT_CHARS + 1 },
        { name: 'ok.log', size: MAX_ATTACHMENT_CHARS },
      ],
      []
    );
    expect(r.accepted.map((c) => c.name)).toEqual(['ok.log']);
    expect(r.rejections.tooLarge).toEqual(['big.log']);
  });

  it('skips files already attached by name', () => {
    const r = filterAttachmentCandidates([{ name: 'a.md', size: 1 }], [att('a.md')]);
    expect(r.accepted).toEqual([]);
    expect(Object.values(r.rejections).every((l) => l.length === 0)).toBe(true);
  });

  it('enforces the per-message attachment quota', () => {
    const candidates = Array.from({ length: MAX_ATTACHMENTS + 2 }, (_, i) => ({
      name: `f${i}.txt`,
      size: 1,
    }));
    const r = filterAttachmentCandidates(candidates, [att('already.txt')]);
    expect(r.accepted).toHaveLength(MAX_ATTACHMENTS - 1);
    expect(r.rejections.tooMany).toEqual(['f4.txt', 'f5.txt', 'f6.txt']);
  });

  it('ignores non-finite size (dialog path has no stat)', () => {
    const r = filterAttachmentCandidates([{ name: 'a.md', size: Number.NaN }], []);
    expect(r.accepted.map((c) => c.name)).toEqual(['a.md']);
  });
});
