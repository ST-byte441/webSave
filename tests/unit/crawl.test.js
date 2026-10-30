import { describe, it, expect, vi } from 'vitest';
import { crawl } from '../../extension/lib/crawler.js';

const BASE = 'https://docs.example.com/guide/';
const OPTIONS = { depth: 1, maxPages: 20, scope: 'prefix' };
const noSleep = async () => {};

function makePage(url, links = [], requestedUrl = url) {
  return {
    url,
    requestedUrl,
    title: url,
    textLength: 500,
    contentHtml: links.map((href) => `<p><a href="${href}">link</a></p>`).join(''),
  };
}

function fakeSite(site) {
  const calls = [];
  async function capturePage(url) {
    calls.push(url);
    const entry = site[url];
    if (!entry) {
      const error = new Error('HTTP 404');
      error.reason = 'HTTP 404';
      throw error;
    }
    return makePage(entry.finalUrl ?? url, entry.links ?? [], url);
  }
  return { calls, capturePage };
}

const urls = (result) => result.pages.map((page) => page.url);

describe('crawl', () => {
  it('captures pages linked from the start page, in link order, at depth 1', async () => {
    const start = makePage(`${BASE}intro`, [`${BASE}b`, `${BASE}a`]);
    const { calls, capturePage } = fakeSite({ [`${BASE}a`]: { links: [`${BASE}c`] }, [`${BASE}b`]: {} });
    const result = await crawl({ start, options: OPTIONS, capturePage, sleep: noSleep });
    expect(urls(result)).toEqual([`${BASE}intro`, `${BASE}b`, `${BASE}a`]);
    expect(calls).not.toContain(`${BASE}c`);
    expect(result.cancelled).toBe(false);
  });

  it('goes breadth-first at depth 2', async () => {
    const start = makePage(`${BASE}intro`, [`${BASE}a`, `${BASE}b`]);
    const { capturePage } = fakeSite({
      [`${BASE}a`]: { links: [`${BASE}c`] },
      [`${BASE}b`]: { links: [`${BASE}d`] },
      [`${BASE}c`]: {},
      [`${BASE}d`]: {},
    });
    const result = await crawl({ start, options: { ...OPTIONS, depth: 2 }, capturePage, sleep: noSleep });
    expect(urls(result)).toEqual([`${BASE}intro`, `${BASE}a`, `${BASE}b`, `${BASE}c`, `${BASE}d`]);
  });

  it('stops at maxPages, counting the start page', async () => {
    const start = makePage(`${BASE}intro`, [`${BASE}a`, `${BASE}b`, `${BASE}c`, `${BASE}d`]);
    const { calls, capturePage } = fakeSite({ [`${BASE}a`]: {}, [`${BASE}b`]: {}, [`${BASE}c`]: {}, [`${BASE}d`]: {} });
    const result = await crawl({ start, options: { ...OPTIONS, maxPages: 3 }, capturePage, sleep: noSleep });
    expect(urls(result)).toEqual([`${BASE}intro`, `${BASE}a`, `${BASE}b`]);
    expect(calls).toEqual([`${BASE}a`, `${BASE}b`]);
  });

  it('skips out-of-scope and file links', async () => {
    const links = [`${BASE}a`, 'https://docs.example.com/blog/x', 'https://other.com/guide/a', `${BASE}manual.pdf`];
    const site = { [`${BASE}a`]: {}, 'https://docs.example.com/blog/x': {} };

    const prefix = fakeSite(site);
    await crawl({ start: makePage(`${BASE}intro`, links), options: OPTIONS, capturePage: prefix.capturePage, sleep: noSleep });
    expect(prefix.calls).toEqual([`${BASE}a`]);

    const domain = fakeSite(site);
    await crawl({ start: makePage(`${BASE}intro`, links), options: { ...OPTIONS, scope: 'domain' }, capturePage: domain.capturePage, sleep: noSleep });
    expect(domain.calls).toEqual([`${BASE}a`, 'https://docs.example.com/blog/x']);
  });

  it('records failures and keeps going', async () => {
    const start = makePage(`${BASE}intro`, [`${BASE}missing`, `${BASE}a`]);
    const { capturePage } = fakeSite({ [`${BASE}a`]: {} });
    const result = await crawl({ start, options: OPTIONS, capturePage, sleep: noSleep });
    expect(urls(result)).toEqual([`${BASE}intro`, `${BASE}a`]);
    expect(result.failures).toEqual([{ url: `${BASE}missing`, reason: 'HTTP 404' }]);
  });

  it('never refetches the start page or fragment and trailing-slash variants', async () => {
    const start = makePage(`${BASE}intro`, [`${BASE}intro#setup`, `${BASE}a`, `${BASE}a/`, `${BASE}a#x`]);
    const { calls, capturePage } = fakeSite({ [`${BASE}a`]: { links: [`${BASE}intro`] } });
    await crawl({ start, options: { ...OPTIONS, depth: 2 }, capturePage, sleep: noSleep });
    expect(calls).toEqual([`${BASE}a`]);
  });

  it('drops a page that redirects to a page already captured', async () => {
    const start = makePage(`${BASE}intro`, [BASE, `${BASE}a`]);
    const { calls, capturePage } = fakeSite({ [BASE]: { finalUrl: `${BASE}intro` }, [`${BASE}a`]: {} });
    const result = await crawl({ start, options: OPTIONS, capturePage, sleep: noSleep });
    expect(calls).toContain(BASE);
    expect(urls(result)).toEqual([`${BASE}intro`, `${BASE}a`]);
  });

  it('stops when cancelled and returns what it captured', async () => {
    const controller = new AbortController();
    const start = makePage(`${BASE}intro`, [`${BASE}a`, `${BASE}b`, `${BASE}c`]);
    const capturePage = vi.fn(async (url) => {
      controller.abort();
      return makePage(url);
    });
    const result = await crawl({ start, options: OPTIONS, capturePage, signal: controller.signal, sleep: noSleep, concurrency: 1 });
    expect(capturePage).toHaveBeenCalledTimes(1);
    expect(result.cancelled).toBe(true);
    expect(urls(result)).toEqual([`${BASE}intro`, `${BASE}a`]);
  });

  it('runs at most 2 fetches at once and waits 500 ms between starts', async () => {
    const sleep = vi.fn(async () => {});
    let active = 0;
    let peak = 0;
    const capturePage = async (url) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return makePage(url);
    };
    const start = makePage(`${BASE}intro`, ['a', 'b', 'c', 'd', 'e'].map((n) => `${BASE}${n}`));
    await crawl({ start, options: OPTIONS, capturePage, sleep });
    expect(peak).toBe(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it('reports progress including the start page', async () => {
    const onProgress = vi.fn();
    const start = makePage(`${BASE}intro`, [`${BASE}a`, `${BASE}b`]);
    const { capturePage } = fakeSite({ [`${BASE}a`]: {}, [`${BASE}b`]: {} });
    await crawl({ start, options: OPTIONS, capturePage, sleep: noSleep, onProgress });
    expect(onProgress).toHaveBeenLastCalledWith({ done: 3, total: 3 });
  });
});
