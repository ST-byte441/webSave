// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderDocument } from '../../extension/lib/assembler.js';
import { parseHtml } from '../../extension/lib/capturer.js';
import { cleanDocument } from '../../extension/lib/cleaner.js';
import { addPage, loadPages } from '../../extension/lib/collection.js';
import { embedImages } from '../../extension/lib/images.js';

globalThis.DOMParser = new JSDOM('').window.DOMParser;

function fakeArea() {
  const data = {};
  return {
    data,
    async get(keys) {
      const list = keys == null ? Object.keys(data) : [keys].flat();
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const k of [keys].flat()) delete data[k];
    },
  };
}

const prose = (topic) => `<p>${`This section covers ${topic} step by step, with details, examples, and caveats. `.repeat(6)}</p>`;
const html = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><article><h1>${title}</h1>${body}</article></body></html>`;
const capture = (url, source) => ({
  ...cleanDocument(parseHtml(source), url), requestedUrl: url, method: 'tab', capturedAt: '2026-10-30T00:00:00.000Z',
});

describe('collection to document', () => {
  it('stored pages render in added order with rewritten links and embedded images', async () => {
    const alpha = capture('https://site.test/a', html('Alpha', [
      prose('the alpha topic'),
      `<p>${prose('links')} See <a href="https://site.test/b#top">Beta</a> next.</p>`,
      '<img src="https://cdn.test/x.png" alt="X">',
    ].join('')));
    const beta = capture('https://site.test/b', html('Beta', prose('the beta topic')));

    const area = fakeArea();
    await addPage(area, beta);
    await addPage(area, alpha);
    const pages = await loadPages(area);

    const fetchFn = async () => ({
      ok: true,
      status: 200,
      headers: new Map([['content-type', 'image/png'], ['content-length', '4']]),
      blob: async () => new Blob([new Uint8Array(4)], { type: 'image/png' }),
    });
    const images = await embedImages(pages, { fetchFn, createObjectURL: () => 'blob:fake' });

    const doc = new JSDOM('<!doctype html><html><head></head><body></body></html>').window.document;
    renderDocument(doc, { pages: images.pages, capturedAt: new Date('2026-10-30'), report: null });

    expect([...doc.querySelectorAll('section.page > h1')].map((h) => h.textContent)).toEqual(['Beta', 'Alpha']);
    const alphaSection = doc.querySelector('#page-2');
    expect(alphaSection.querySelector('a[href^="#"]').getAttribute('href')).toBe('#page-1');
    expect(alphaSection.querySelector('img').getAttribute('src')).toBe('blob:fake');
    expect(doc.querySelector('nav.toc')).not.toBeNull();
  });
});
