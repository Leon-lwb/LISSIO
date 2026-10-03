import { describe, expect, it } from 'vitest';
import { decodeText } from '../textEncoding';

describe('decodeText', () => {
  it('decodes UTF-8 and GBK bytes', () => {
    expect(decodeText(Uint8Array.from([0xe4, 0xbd, 0xa0]), 'utf8')).toBe('你');
    expect(decodeText(Uint8Array.from([0xc4, 0xe3]), 'gbk')).toBe('你');
  });

  it('replaces invalid encoded bytes', () => {
    expect(decodeText(Uint8Array.from([0xff]), 'utf8')).toBe('\ufffd');
    expect(decodeText(Uint8Array.from([0x81]), 'gbk')).toBe('\ufffd');
  });
});
