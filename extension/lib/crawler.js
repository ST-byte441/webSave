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
