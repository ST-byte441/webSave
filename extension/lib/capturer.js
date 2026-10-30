import { MIN_TEXT_LENGTH } from './cleaner.js';
import { sleep } from './concurrency.js';

export const FETCH_TIMEOUT_MS = 20000;
const SETTLE_MS = 1500;
const LOGIN_HINT = /login|signin|sign-in|auth|sso/i;
const BLOCKED_HOSTS = ['chromewebstore.google.com', 'addons.mozilla.org', 'microsoftedge.microsoft.com'];

export class CaptureError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'CaptureError';
    this.reason = reason;
  }
}

export function isRestrictedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  if (BLOCKED_HOSTS.includes(parsed.hostname)) return true;
  if (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) return true;
  return parsed.pathname.toLowerCase().endsWith('.pdf');
}

export function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

const pathOf = (url) => new URL(url).pathname.replace(/\/$/, '') || '/';

export function isLoginRedirect(requestedUrl, finalUrl, doc) {
  if (pathOf(requestedUrl) === pathOf(finalUrl)) return false;
  return doc.querySelector('input[type="password"]') !== null || LOGIN_HINT.test(finalUrl);
}

async function fetchHtml(fetchFn, url, timeoutMs, signal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    if (!response.ok) throw new CaptureError(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (type && !type.includes('html')) throw new CaptureError(`not an HTML page (${type})`);
    return { html: await response.text(), finalUrl: response.url || url };
  } catch (error) {
    if (error instanceof CaptureError) throw error;
    if (timedOut) throw new CaptureError('timeout');
    if (signal?.aborted) throw new CaptureError('cancelled');
    throw new CaptureError(`network error: ${error.message}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function checkAndClean(requestedUrl, finalUrl, html, clean) {
  const doc = parseHtml(html);
  if (isLoginRedirect(requestedUrl, finalUrl, doc)) throw new CaptureError('redirected to login');
  return clean(doc, finalUrl);
}

export function createPageCapturer({ fetchFn, renderInTab, clean, timeoutMs = FETCH_TIMEOUT_MS }) {
  return async function capturePage(url, signal) {
    const { html, finalUrl } = await fetchHtml(fetchFn, url, timeoutMs, signal);
    let page = checkAndClean(url, finalUrl, html, clean);
    let method = 'fetch';
    if (page.textLength < MIN_TEXT_LENGTH) {
      const rendered = await renderInTab(url, signal);
      page = checkAndClean(url, rendered.url, rendered.html, clean);
      method = 'background-tab';
    }
    return { ...page, requestedUrl: url, method, capturedAt: new Date().toISOString() };
  };
}

// Runs inside the target tab, so it must not use anything from this module.
function readPage() {
  return { html: document.documentElement.outerHTML, url: location.href };
}

export async function captureTab(api, tabId, clean) {
  const [injection] = await api.scripting.executeScript({ target: { tabId }, func: readPage });
  const { html, url } = injection.result;
  return { ...clean(parseHtml(html), url), requestedUrl: url, method: 'tab', capturedAt: new Date().toISOString() };
}

function waitForTabComplete(api, tabId, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      api.tabs.onUpdated.removeListener(onUpdated);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const onAbort = () => finish(new CaptureError('cancelled'));
    const timer = setTimeout(() => finish(new CaptureError('timeout')), timeoutMs);
    api.tabs.onUpdated.addListener(onUpdated);
    signal?.addEventListener('abort', onAbort);
    api.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete' && tab.url !== 'about:blank') finish();
    }, () => {});
  });
}

export async function renderInBackgroundTab(api, url, { signal, timeoutMs = FETCH_TIMEOUT_MS, settleMs = SETTLE_MS } = {}) {
  const tab = await api.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(api, tab.id, timeoutMs, signal);
    await sleep(settleMs);
    const [injection] = await api.scripting.executeScript({ target: { tabId: tab.id }, func: readPage });
    return injection.result;
  } finally {
    api.tabs.remove(tab.id).catch(() => {});
  }
}
