import { createLimiter, sleep as defaultSleep } from './concurrency.js';

const FILE_EXTENSIONS = [
  '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z', '.exe', '.dmg', '.msi',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico',
  '.mp3', '.mp4', '.mov', '.avi', '.webm',
  '.csv', '.xls', '.xlsx', '.doc', '.docx', '.ppt', '.pptx',
];

export function normalizeUrl(href, base) {
  let url;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  return url.href;
}

export function urlKey(url) {
  const parsed = new URL(url);
  parsed.hash = '';
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.href;
}

export function scopePrefix(startUrl) {
  const { origin, pathname } = new URL(startUrl);
  return origin + pathname.slice(0, pathname.lastIndexOf('/') + 1);
}

export function inScope(url, startUrl, scope) {
  if (scope === 'domain') return new URL(url).hostname === new URL(startUrl).hostname;
  return url.startsWith(scopePrefix(startUrl));
}

export function isFileLink(url) {
  const path = new URL(url).pathname.toLowerCase();
  return FILE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function extractLinks(contentHtml, pageUrl) {
  const doc = new DOMParser().parseFromString(contentHtml, 'text/html');
  const links = [];
  const seen = new Set();
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const url = normalizeUrl(anchor.getAttribute('href'), pageUrl);
    if (!url || seen.has(urlKey(url))) continue;
    seen.add(urlKey(url));
    links.push(url);
  }
  return links;
}

export async function crawl({
  start,
  options,
  capturePage,
  signal,
  onProgress = () => {},
  sleep = defaultSleep,
  delayMs = 500,
  concurrency = 2,
}) {
  const pages = [start];
  const failures = [];
  const seen = new Set([urlKey(start.url), urlKey(start.requestedUrl ?? start.url)]);
  const captured = new Set([urlKey(start.url)]);
  const limit = createLimiter(concurrency);
  let planned = 1;
  let done = 1;

  // Each fetch start waits for the previous start plus delayMs.
  let gate = Promise.resolve();
  const waitTurn = () => {
    const turn = gate;
    gate = gate.then(() => sleep(delayMs));
    return turn;
  };

  async function captureOne(url) {
    await waitTurn();
    if (signal?.aborted) return null;
    try {
      return { page: await capturePage(url, signal) };
    } catch (error) {
      return signal?.aborted ? null : { failure: { url, reason: error.reason ?? error.message } };
    }
  }

  let level = [start];
  for (let depth = 1; depth <= options.depth && level.length > 0; depth++) {
    const urls = [];
    for (const page of level) {
      for (const url of extractLinks(page.contentHtml, page.url)) {
        if (planned >= options.maxPages) break;
        const key = urlKey(url);
        if (seen.has(key) || isFileLink(url) || !inScope(url, start.url, options.scope)) continue;
        seen.add(key);
        urls.push(url);
        planned++;
      }
    }
    onProgress({ done, total: planned });

    const results = await Promise.all(urls.map((url) => limit(async () => {
      const result = await captureOne(url);
      done++;
      onProgress({ done, total: planned });
      return result;
    })));

    level = [];
    for (const result of results) {
      if (result?.failure) failures.push(result.failure);
      if (!result?.page) continue;
      const key = urlKey(result.page.url);
      if (captured.has(key)) continue;
      captured.add(key);
      seen.add(key);
      pages.push(result.page);
      level.push(result.page);
    }
    if (signal?.aborted) return { pages, failures, cancelled: true };
  }
  return { pages, failures, cancelled: false };
}
