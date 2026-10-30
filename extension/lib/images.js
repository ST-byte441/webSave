import { createLimiter } from './concurrency.js';
import { largestCandidate, parseSrcset } from './srcset.js';

const LAZY_ATTRIBUTES = ['data-src', 'data-lazy-src', 'data-original'];
const STALE_ATTRIBUTES = ['srcset', 'data-srcset', 'sizes', 'loading', ...LAZY_ATTRIBUTES];
const PLACEHOLDER_PATTERN = /placeholder|blank|spacer/i;
const MB = 1024 * 1024;

const isPlaceholder = (src) => !src || src.startsWith('data:') || PLACEHOLDER_PATTERN.test(src);
const formatMb = (bytes) => `${Math.round((bytes / MB) * 10) / 10} MB`;

export function pickImageSource(img) {
  const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
  const fromSrcset = srcset ? largestCandidate(parseSrcset(srcset)) : null;
  if (fromSrcset && !fromSrcset.startsWith('data:')) return fromSrcset;
  const src = img.getAttribute('src')?.trim() || null;
  if (isPlaceholder(src)) {
    for (const attribute of LAZY_ATTRIBUTES) {
      const value = img.getAttribute(attribute)?.trim();
      if (value) return value;
    }
  }
  return src;
}

function embed(img, objectUrl) {
  img.setAttribute('src', objectUrl);
  for (const attribute of STALE_ATTRIBUTES) img.removeAttribute(attribute);
}

function replaceWithPlaceholder(img, imageUrl, reason) {
  const doc = img.ownerDocument;
  const alt = img.getAttribute('alt')?.trim();
  const box = doc.createElement('div');
  box.className = 'img-missing';
  box.append(`Image unavailable${alt ? `: ${alt}` : ''} (${reason})`);
  if (imageUrl) {
    const url = doc.createElement('div');
    url.className = 'img-url';
    url.textContent = imageUrl;
    box.append(url);
  }
  (img.closest('picture') ?? img).replaceWith(box);
}

export async function embedImages(pages, {
  fetchFn,
  createObjectURL,
  signal,
  onProgress = () => {},
  maxImageBytes = 10 * MB,
  maxTotalBytes = 150 * MB,
  concurrency = 4,
}) {
  const limit = createLimiter(concurrency);
  const downloads = new Map();
  const failures = [];
  const warnings = [];
  let totalBytes = 0;

  async function download(url) {
    if (signal?.aborted) return { error: 'cancelled' };
    try {
      const response = await fetchFn(url, { signal });
      if (!response.ok) return { error: `HTTP ${response.status}` };
      const type = response.headers.get('content-type') ?? '';
      if (type && !type.startsWith('image/') && !type.startsWith('application/octet-stream')) {
        return { error: `not an image (${type})` };
      }
      const blob = await response.blob();
      if (blob.size > maxImageBytes) return { error: `too large (over ${formatMb(maxImageBytes)})` };
      if (totalBytes + blob.size > maxTotalBytes) {
        if (warnings.length === 0) warnings.push(`Image limit of ${formatMb(maxTotalBytes)} reached; the remaining images were skipped.`);
        return { error: 'total image limit reached' };
      }
      totalBytes += blob.size;
      return { objectUrl: createObjectURL(blob) };
    } catch (error) {
      return { error: signal?.aborted ? 'cancelled' : error.message || 'download failed' };
    }
  }

  const downloadOnce = (url) => {
    if (!downloads.has(url)) downloads.set(url, limit(() => download(url)));
    return downloads.get(url);
  };

  const parsed = pages.map((page) => {
    const doc = new DOMParser().parseFromString(page.contentHtml, 'text/html');
    for (const source of doc.querySelectorAll('picture source')) source.remove();
    return { page, doc };
  });
  const jobs = parsed.flatMap(({ page, doc }) => [...doc.querySelectorAll('img')].map((img) => ({ page, img })));

  let done = 0;
  onProgress({ done, total: jobs.length });
  await Promise.all(jobs.map(async ({ page, img }) => {
    const url = pickImageSource(img);
    let reason = null;
    if (!url) reason = 'no image source';
    else if (!url.startsWith('data:')) {
      const result = await downloadOnce(url);
      if (result.objectUrl) embed(img, result.objectUrl);
      else reason = result.error;
    }
    if (reason) {
      replaceWithPlaceholder(img, url, reason);
      failures.push({ pageUrl: page.url, imageUrl: url, reason });
    }
    done++;
    onProgress({ done, total: jobs.length });
  }));

  return {
    pages: parsed.map(({ page, doc }) => ({ ...page, contentHtml: doc.body.innerHTML })),
    failures,
    warnings,
  };
}
