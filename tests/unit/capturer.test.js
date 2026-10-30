import { describe, it, expect, vi } from 'vitest';
import {
  captureTab, createPageCapturer, isLoginRedirect, isRestrictedUrl, parseHtml, renderInBackgroundTab,
} from '../../extension/lib/capturer.js';

const LONG = `<p>${'Real content here. '.repeat(20)}</p>`;
const fakeClean = (doc, url) => ({
  url,
  title: doc.title || url,
  byline: null,
  contentHtml: doc.body.innerHTML,
  textLength: doc.body.textContent.trim().length,
});

function htmlResponse(html, { status = 200, url = '', type = 'text/html; charset=utf-8' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: new Map([['content-type', type]]),
    text: async () => html,
  };
}

async function reasonOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error.reason;
  }
  throw new Error('expected a CaptureError');
}

describe('isRestrictedUrl', () => {
  it('blocks pages extensions cannot read', () => {
    for (const url of [
      'chrome://extensions', 'about:blank', 'moz-extension://x/page.html', 'not a url',
      'https://chromewebstore.google.com/detail/x', 'https://chrome.google.com/webstore/detail/x',
      'https://addons.mozilla.org/en-US/firefox/', 'https://site.com/files/report.PDF',
    ]) expect(isRestrictedUrl(url), url).toBe(true);
  });

  it('allows normal web pages', () => {
    expect(isRestrictedUrl('https://site.com/page')).toBe(false);
    expect(isRestrictedUrl('http://localhost:8080/')).toBe(false);
  });
});

describe('isLoginRedirect', () => {
  const withPassword = parseHtml('<form><input type="password"></form>');
  const plain = parseHtml('<p>hi</p>');

  it('is false when the path did not change', () => {
    expect(isLoginRedirect('https://x.com/a', 'https://x.com/a', withPassword)).toBe(false);
    expect(isLoginRedirect('https://x.com/a', 'https://x.com/a/', withPassword)).toBe(false);
  });

  it('is true when redirected to a page with a password field or a login-like URL', () => {
    expect(isLoginRedirect('https://x.com/a', 'https://x.com/welcome', withPassword)).toBe(true);
    expect(isLoginRedirect('https://x.com/a', 'https://x.com/signin?next=/a', plain)).toBe(true);
    expect(isLoginRedirect('https://x.com/a', 'https://sso.x.com/start', plain)).toBe(true);
  });

  it('is false for an ordinary redirect', () => {
    expect(isLoginRedirect('https://x.com/old', 'https://x.com/new', plain)).toBe(false);
  });
});

describe('createPageCapturer', () => {
  const renderInTab = vi.fn();
  const make = (fetchFn, timeoutMs) => createPageCapturer({ fetchFn, renderInTab, clean: fakeClean, timeoutMs });

  it('fetches and cleans a page, recording the final URL and metadata', async () => {
    const fetchFn = vi.fn(async () => htmlResponse(`<title>A</title>${LONG}`, { url: 'https://x.com/a-final' }));
    const page = await make(fetchFn)('https://x.com/a');
    expect(page.url).toBe('https://x.com/a-final');
    expect(page.requestedUrl).toBe('https://x.com/a');
    expect(page.method).toBe('fetch');
    expect(page.title).toBe('A');
    expect(typeof page.capturedAt).toBe('string');
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects HTTP errors and non-HTML responses', async () => {
    expect(await reasonOf(make(async () => htmlResponse('', { status: 404 }))('https://x.com/a'))).toBe('HTTP 404');
    expect(await reasonOf(make(async () => htmlResponse('{}', { type: 'application/json' }))('https://x.com/a')))
      .toBe('not an HTML page (application/json)');
  });

  it('rejects login redirects', async () => {
    const fetchFn = async () => htmlResponse('<input type="password">', { url: 'https://x.com/login' });
    expect(await reasonOf(make(fetchFn)('https://x.com/private'))).toBe('redirected to login');
  });

  it('falls back to a background tab when the fetched page has too little text', async () => {
    const tab = vi.fn(async (url) => ({ url, html: `<title>App</title>${LONG}` }));
    const capture = createPageCapturer({ fetchFn: async () => htmlResponse('<div id="root"></div>'), renderInTab: tab, clean: fakeClean });
    const page = await capture('https://x.com/app');
    expect(tab).toHaveBeenCalledWith('https://x.com/app', undefined);
    expect(page.method).toBe('background-tab');
    expect(page.title).toBe('App');
  });

  it('times out slow pages', async () => {
    const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await reasonOf(make(hang, 10)('https://x.com/slow'))).toBe('timeout');
  });

  it('rejects a background tab that never left about:blank', async () => {
    const capture = createPageCapturer({
      fetchFn: async () => htmlResponse('<div id="root"></div>'),
      renderInTab: async () => ({ url: 'about:blank', html: `<title>about:blank</title>${LONG}` }),
      clean: fakeClean,
    });
    expect(await reasonOf(capture('https://x.com/app'))).toBe('background tab did not load');
  });

  it('reports network errors', async () => {
    expect(await reasonOf(make(async () => { throw new Error('boom'); })('https://x.com/a'))).toBe('network error: boom');
  });
});

function fakeTabsApi({ completes = true } = {}) {
  const listeners = new Set();
  return {
    fire: (...args) => listeners.forEach((listener) => listener(...args)),
    tabs: {
      create: vi.fn(async () => {
        if (completes) setTimeout(() => listeners.forEach((listener) => listener(7, { status: 'complete' }, { id: 7, url: 'https://x.com/app' })), 0);
        return { id: 7 };
      }),
      get: vi.fn(async () => ({ id: 7, status: 'loading', url: 'about:blank' })),
      remove: vi.fn(async () => {}),
      onUpdated: {
        addListener: (listener) => listeners.add(listener),
        removeListener: (listener) => listeners.delete(listener),
      },
    },
    scripting: {
      executeScript: vi.fn(async () => [{ result: { html: `<title>Live</title>${LONG}`, url: 'https://x.com/live' } }]),
    },
  };
}

describe('captureTab', () => {
  it('reads the live DOM of the source tab', async () => {
    const api = fakeTabsApi();
    const page = await captureTab(api, 42, fakeClean);
    expect(api.scripting.executeScript.mock.calls[0][0].target).toEqual({ tabId: 42 });
    expect(page).toMatchObject({ url: 'https://x.com/live', requestedUrl: 'https://x.com/live', title: 'Live', method: 'tab' });
  });
});

describe('renderInBackgroundTab', () => {
  it('opens an inactive tab, reads it after load, then closes it', async () => {
    const api = fakeTabsApi();
    const result = await renderInBackgroundTab(api, 'https://x.com/app', { settleMs: 0 });
    expect(api.tabs.create).toHaveBeenCalledWith({ url: 'https://x.com/app', active: false });
    expect(result.url).toBe('https://x.com/live');
    expect(api.tabs.remove).toHaveBeenCalledWith(7);
  });

  it('ignores the initial about:blank load and waits for the real page', async () => {
    const api = fakeTabsApi({ completes: false });
    let realLoaded = false;
    api.tabs.create = vi.fn(async () => {
      setTimeout(() => api.fire(7, { status: 'complete' }, { id: 7, url: 'about:blank' }), 0);
      setTimeout(() => {
        realLoaded = true;
        api.fire(7, { status: 'complete' }, { id: 7, url: 'https://x.com/app' });
      }, 20);
      return { id: 7 };
    });
    const readAfterLoad = [];
    api.scripting.executeScript = vi.fn(async () => {
      readAfterLoad.push(realLoaded);
      return [{ result: { html: '<p>x</p>', url: 'https://x.com/app' } }];
    });
    await renderInBackgroundTab(api, 'https://x.com/app', { settleMs: 0 });
    expect(readAfterLoad).toEqual([true]);
  });

  it('times out and still closes the tab', async () => {
    const api = fakeTabsApi({ completes: false });
    expect(await reasonOf(renderInBackgroundTab(api, 'https://x.com/app', { timeoutMs: 10, settleMs: 0 }))).toBe('timeout');
    expect(api.tabs.remove).toHaveBeenCalledWith(7);
  });
});
