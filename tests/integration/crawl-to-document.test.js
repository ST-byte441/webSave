// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import { JSDOM } from 'jsdom';
import { renderDocument } from '../../extension/lib/assembler.js';
import { createPageCapturer, parseHtml } from '../../extension/lib/capturer.js';
import { cleanDocument } from '../../extension/lib/cleaner.js';
import { crawl } from '../../extension/lib/crawler.js';
import { embedImages } from '../../extension/lib/images.js';

globalThis.DOMParser = new JSDOM('').window.DOMParser;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const prose = (topic) => `<p>${`This section covers ${topic} step by step, with details, examples, and caveats. `.repeat(6)}</p>`;
const context = 'This sentence gives the link below enough surrounding text to read like prose. ';
const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body><nav><a href="/about">About</a></nav><article><h1>${title}</h1>${body}</article></body></html>`;

const ROUTES = {
  '/docs/guide/intro': page('Intro', [
    prose('the basics'),
    `<p>${context}First read <a href="setup">Setup</a>, then the <a href="advanced">Advanced</a> topics.</p>`,
    prose('the layout'),
    `<p>${context}Some old links: the <a href="missing">missing page</a> and the <a href="private">private notes</a>.</p>`,
    `<p>${context}Also the <a href="app">interactive app</a>, the <a href="manual.pdf">PDF manual</a> and <a href="/about">about us</a>.</p>`,
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="/img/diagram.png" alt="Diagram">',
  ].join('')),
  '/docs/guide/setup': page('Setup', `${prose('setup')}<p>${context}Next, the <a href="setup/deep">deep dive</a>.</p><img src="/img/diagram.png" alt="Diagram again">`),
  '/docs/guide/advanced': page('Advanced', prose('advanced usage')),
  '/docs/guide/setup/deep': page('Deep', `${prose('internals')}<p>${context}Even more in <a href="deeper">deeper</a>.</p>`),
  '/docs/guide/setup/deeper': page('Deeper', prose('more internals')),
  '/docs/guide/app': '<!doctype html><html><head><title>App</title></head><body><div id="root"></div></body></html>',
  '/login': '<!doctype html><html><head><title>Sign in</title></head><body><form><input type="password" name="pw"></form></body></html>',
};

let server;
let base;
const requests = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/docs/guide/private') {
      res.writeHead(302, { location: '/login' });
      return res.end();
    }
    if (req.url === '/img/diagram.png') {
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    const html = ROUTES[req.url];
    if (!html) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<h1>Not found</h1>');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('crawl to document', () => {
  it('crawls, cleans, embeds images and assembles one document', async () => {
    const startUrl = `${base}/docs/guide/intro`;
    const start = {
      ...cleanDocument(parseHtml(ROUTES['/docs/guide/intro']), startUrl),
      requestedUrl: startUrl,
      method: 'tab',
      capturedAt: new Date().toISOString(),
    };
    const renderInTab = async (url) => ({ url, html: page('App', prose('the interactive app')) });
    const capturePage = createPageCapturer({ fetchFn: (url, init) => fetch(url, init), renderInTab, clean: cleanDocument });

    const crawled = await crawl({
      start,
      options: { depth: 2, maxPages: 20, scope: 'prefix' },
      capturePage,
      sleep: async () => {},
    });

    expect(crawled.pages.map((p) => new URL(p.url).pathname)).toEqual([
      '/docs/guide/intro', '/docs/guide/setup', '/docs/guide/advanced', '/docs/guide/app', '/docs/guide/setup/deep',
    ]);
    expect(crawled.pages.find((p) => p.url.endsWith('/app')).method).toBe('background-tab');
    expect(crawled.failures).toEqual([
      { url: `${base}/docs/guide/missing`, reason: 'HTTP 404' },
      { url: `${base}/docs/guide/private`, reason: 'redirected to login' },
    ]);
    expect(requests).not.toContain('/about');
    expect(requests).not.toContain('/docs/guide/manual.pdf');
    expect(requests).not.toContain('/docs/guide/setup/deeper');

    let objectUrls = 0;
    const images = await embedImages(crawled.pages, {
      fetchFn: (url, init) => fetch(url, init),
      createObjectURL: () => `blob:test/${++objectUrls}`,
    });
    expect(requests.filter((r) => r === '/img/diagram.png')).toHaveLength(1);
    expect(images.failures).toEqual([]);
    expect(images.pages[0].contentHtml).toContain('src="blob:test/1"');
    expect(images.pages[1].contentHtml).toContain('src="blob:test/1"');

    const output = new JSDOM('<!doctype html><html><head><title></title></head><body></body></html>').window.document;
    renderDocument(output, {
      pages: images.pages,
      capturedAt: new Date(2026, 9, 29),
      report: { failures: crawled.failures, imageFailures: images.failures, warnings: images.warnings },
    });
    expect(output.title).toBe('Intro - 2026-10-29');
    expect(output.querySelectorAll('.toc li')).toHaveLength(5);
    expect(output.querySelector('#page-1 a[href="#page-2"]')?.textContent).toBe('Setup');
    expect(output.querySelector('.report').textContent).toContain('redirected to login');
  });
});
