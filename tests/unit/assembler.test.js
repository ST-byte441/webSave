import { describe, it, expect } from 'vitest';
import { documentTitle, formatDate, renderDocument } from '../../extension/lib/assembler.js';

const CAPTURED_AT = new Date(2026, 9, 29, 14, 30);
const BASE = 'https://docs.example.com/guide/';

function page(n, contentHtml = `<p>Body ${n}</p>`, extra = {}) {
  return {
    url: `${BASE}p${n}`,
    requestedUrl: `${BASE}p${n}`,
    title: `Page ${n}`,
    method: 'fetch',
    capturedAt: '2026-10-29T14:30:00.000Z',
    contentHtml,
    ...extra,
  };
}

const freshDocument = () => document.implementation.createHTMLDocument('x');

describe('titles', () => {
  it('formats the local date and the document title', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(documentTitle('Page 1', CAPTURED_AT)).toBe('Page 1 - 2026-10-29');
  });
});

describe('renderDocument', () => {
  it('renders a single page with a title page and no table of contents', () => {
    const doc = freshDocument();
    renderDocument(doc, { pages: [page(1)], capturedAt: CAPTURED_AT, report: null });
    expect(doc.title).toBe('Page 1 - 2026-10-29');
    expect(doc.body.className).toBe('document');
    expect(doc.querySelector('.title-page h1').textContent).toBe('Page 1');
    expect(doc.querySelector('.toc')).toBeNull();
    expect(doc.querySelector('#page-1 h1').textContent).toBe('Page 1');
    expect(doc.querySelector('#page-1 .source').textContent).toBe(`${BASE}p1`);
    expect(doc.querySelector('#page-1 .page-content').innerHTML).toBe('<p>Body 1</p>');
    expect(doc.querySelector('.report')).toBeNull();
  });

  it('adds a table of contents for multiple pages', () => {
    const doc = freshDocument();
    renderDocument(doc, { pages: [page(1), page(2), page(3)], capturedAt: CAPTURED_AT, report: null });
    const links = [...doc.querySelectorAll('.toc a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#page-1', '#page-2', '#page-3']);
    expect(links.map((a) => a.textContent)).toEqual(['Page 1', 'Page 2', 'Page 3']);
    expect(doc.querySelectorAll('section.page')).toHaveLength(3);
  });

  it('points links between captured pages at their sections', () => {
    const doc = freshDocument();
    const first = page(1, `<a href="${BASE}p2/">next</a><a href="${BASE}old">moved</a><a href="https://elsewhere.com/x">ext</a><a href="#local">local</a>`);
    renderDocument(doc, { pages: [first, page(2), page(3, undefined, { requestedUrl: `${BASE}old` })], capturedAt: CAPTURED_AT, report: null });
    const hrefs = [...doc.querySelectorAll('#page-1 .page-content a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['#page-2', '#page-3', 'https://elsewhere.com/x', '#local']);
  });

  it('adds a capture report when asked', () => {
    const doc = freshDocument();
    renderDocument(doc, {
      pages: [page(1)],
      capturedAt: CAPTURED_AT,
      report: {
        failures: [{ url: `${BASE}gone`, reason: 'HTTP 404' }],
        imageFailures: [{ pageUrl: `${BASE}p1`, imageUrl: 'https://x.com/a.png', reason: 'HTTP 403' }],
        warnings: ['Image limit of 150 MB reached; the remaining images were skipped.'],
      },
    });
    const text = doc.querySelector('.report').textContent;
    expect(text).toContain(`${BASE}p1 (fetch, 2026-10-29T14:30:00.000Z)`);
    expect(text).toContain(`${BASE}gone: HTTP 404`);
    expect(text).toContain(`https://x.com/a.png on ${BASE}p1: HTTP 403`);
    expect(text).toContain('Image limit of 150 MB reached');
  });

  it('inserts page titles as text, not HTML', () => {
    const doc = freshDocument();
    renderDocument(doc, { pages: [page(1, '<p>x</p>', { title: '<b>bold</b>' })], capturedAt: CAPTURED_AT, report: null });
    expect(doc.querySelector('#page-1 h1').textContent).toBe('<b>bold</b>');
    expect(doc.querySelector('#page-1 h1 b')).toBeNull();
  });
});
