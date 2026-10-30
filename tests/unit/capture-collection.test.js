// @vitest-environment-options {"url": "http://localhost/capture/capture.html?mode=collection&report=0"}
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const $ = (id) => document.getElementById(id);
const PAGE = {
  url: 'https://site.test/a', requestedUrl: 'https://site.test/a', title: 'Alpha', byline: null,
  contentHtml: '<p>Alpha text</p>', textLength: 10, method: 'tab', capturedAt: '2026-10-30T00:00:00.000Z',
};

async function openCapture({ hasAccess, grant }) {
  document.body.innerHTML = readFileSync('extension/capture/capture.html', 'utf8').match(/<body>([\s\S]*)<\/body>/)[1];
  const data = { 'collection:index': [{ id: 'p1', url: PAGE.url, title: PAGE.title, size: 10 }], 'collection:page:p1': PAGE };
  const api = {
    storage: { session: {
      async get(keys) {
        return Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
      },
    } },
    permissions: {
      contains: vi.fn(async () => hasAccess),
      request: vi.fn(async () => grant),
    },
  };
  globalThis.browser = api;
  Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true });
  window.print = vi.fn();
  vi.resetModules();
  await import('../../extension/capture/capture.js');
  await tick();
  return api;
}

describe('capture tab collection mode', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('asks for all-sites access in the tab before building the PDF', async () => {
    const api = await openCapture({ hasAccess: false, grant: true });
    expect($('access').hidden).toBe(false);
    expect(window.print).not.toHaveBeenCalled();
    $('allow-access').click();
    await tick();
    expect(api.permissions.request).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    expect(window.print).toHaveBeenCalled();
  });

  it('continues without access when the user skips it', async () => {
    await openCapture({ hasAccess: false, grant: false });
    $('skip-access').click();
    await tick();
    expect(window.print).toHaveBeenCalled();
  });

  it('does not ask when access is already granted', async () => {
    const api = await openCapture({ hasAccess: true, grant: true });
    expect(api.permissions.request).not.toHaveBeenCalled();
    expect(window.print).toHaveBeenCalled();
  });
});
