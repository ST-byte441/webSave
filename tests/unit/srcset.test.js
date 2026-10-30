import { describe, it, expect } from 'vitest';
import { formatSrcset, largestCandidate, parseSrcset } from '../../extension/lib/srcset.js';

describe('srcset helpers', () => {
  it('parses candidates with and without descriptors', () => {
    expect(parseSrcset('a.png 480w,  b.png 1200w , c.png')).toEqual([
      { url: 'a.png', descriptor: '480w' },
      { url: 'b.png', descriptor: '1200w' },
      { url: 'c.png', descriptor: '' },
    ]);
  });

  it('formats candidates back into a srcset string', () => {
    expect(formatSrcset([{ url: 'a.png', descriptor: '1x' }, { url: 'b.png', descriptor: '' }])).toBe('a.png 1x, b.png');
  });

  it('picks the largest width or density candidate', () => {
    expect(largestCandidate(parseSrcset('a.png 480w, b.png 1200w, c.png 800w'))).toBe('b.png');
    expect(largestCandidate(parseSrcset('a.png, b.png 2x'))).toBe('b.png');
    expect(largestCandidate([])).toBeNull();
  });
});
