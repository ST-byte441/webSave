import { describe, it, expect } from 'vitest';
import { extractLinks, inScope, isFileLink, normalizeUrl, scopePrefix, urlKey } from '../../extension/lib/crawler.js';

describe('normalizeUrl', () => {
  it('resolves relative links and drops the fragment', () => {
    expect(normalizeUrl('../b#top', 'https://x.com/a/c')).toBe('https://x.com/b');
  });

  it('rejects links that are not web pages', () => {
    expect(normalizeUrl('mailto:a@b.com', 'https://x.com/')).toBeNull();
    expect(normalizeUrl('javascript:void(0)', 'https://x.com/')).toBeNull();
    expect(normalizeUrl('http://[bad', 'https://x.com/')).toBeNull();
  });
});

describe('urlKey', () => {
  it('treats trailing-slash and fragment variants as the same page', () => {
    expect(urlKey('https://x.com/guide/')).toBe(urlKey('https://x.com/guide#intro'));
  });

  it('keeps the root path and the query string', () => {
    expect(urlKey('https://x.com/')).toBe('https://x.com/');
    expect(urlKey('https://x.com/search/?q=a')).toBe('https://x.com/search?q=a');
  });
});

describe('scopePrefix', () => {
  it('uses the directory of the start page', () => {
    expect(scopePrefix('https://docs.example.com/guide/intro')).toBe('https://docs.example.com/guide/');
    expect(scopePrefix('https://docs.example.com/guide/')).toBe('https://docs.example.com/guide/');
  });

  it('handles a site root and a query string', () => {
    expect(scopePrefix('https://site.com/')).toBe('https://site.com/');
    expect(scopePrefix('https://site.com/search?q=x')).toBe('https://site.com/');
  });
});

describe('inScope', () => {
  const start = 'https://docs.example.com/guide/intro';

  it('prefix scope keeps only pages under the start directory', () => {
    expect(inScope('https://docs.example.com/guide/setup', start, 'prefix')).toBe(true);
    expect(inScope('https://docs.example.com/blog/post', start, 'prefix')).toBe(false);
    expect(inScope('https://other.com/guide/setup', start, 'prefix')).toBe(false);
  });

  it('domain scope keeps any page on the same hostname', () => {
    expect(inScope('https://docs.example.com/blog/post', start, 'domain')).toBe(true);
    expect(inScope('https://www.example.com/guide/setup', start, 'domain')).toBe(false);
  });
});

describe('isFileLink', () => {
  it('detects downloads by extension, ignoring case and query', () => {
    expect(isFileLink('https://x.com/manual.PDF')).toBe(true);
    expect(isFileLink('https://x.com/a.zip?v=2')).toBe(true);
    expect(isFileLink('https://x.com/guide/setup')).toBe(false);
  });
});

describe('extractLinks', () => {
  it('returns normalized, deduplicated links in document order', () => {
    const html = '<p><a href="b">B</a> <a href="a#x">A</a> <a href="b/">B again</a> <a href="mailto:x@y.z">mail</a> <a>no href</a></p>';
    expect(extractLinks(html, 'https://x.com/docs/start')).toEqual(['https://x.com/docs/b', 'https://x.com/docs/a']);
  });
});
