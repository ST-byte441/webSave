import { formatSrcset, parseSrcset } from './srcset.js';

export const MIN_TEXT_LENGTH = 200;

const URL_ATTRIBUTES = ['href', 'src', 'poster', 'data-src', 'data-lazy-src', 'data-original'];
const SRCSET_ATTRIBUTES = ['srcset', 'data-srcset'];
const JUNK_SELECTOR = 'script, style, noscript, iframe, nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"]';
const JUNK_PATTERN = /cookie|consent|banner|popup|modal|newsletter|advert/i;

function resolve(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return value;
  }
}

export function absolutizeUrls(root, baseUrl) {
  for (const attribute of URL_ATTRIBUTES) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      const value = element.getAttribute(attribute).trim();
      if (value.startsWith('data:') || value.startsWith('javascript:')) continue;
      element.setAttribute(attribute, resolve(value, baseUrl));
    }
  }
  for (const attribute of SRCSET_ATTRIBUTES) {
    for (const element of root.querySelectorAll(`[${attribute}]`)) {
      const candidates = parseSrcset(element.getAttribute(attribute))
        .map((candidate) => ({ ...candidate, url: resolve(candidate.url, baseUrl) }));
      element.setAttribute(attribute, formatSrcset(candidates));
    }
  }
}

function fallbackContent(doc) {
  const body = doc.body.cloneNode(true);
  for (const element of body.querySelectorAll(JUNK_SELECTOR)) element.remove();
  for (const element of body.querySelectorAll('[id], [class]')) {
    if (JUNK_PATTERN.test(`${element.id} ${element.getAttribute('class') ?? ''}`)) element.remove();
  }
  return { html: body.innerHTML, text: body.textContent.trim() };
}

function stripTrackers(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const img of doc.querySelectorAll('img[width][height]')) {
    if (Number(img.getAttribute('width')) <= 1 && Number(img.getAttribute('height')) <= 1) img.remove();
  }
  for (const img of doc.querySelectorAll('nav img, [role="navigation"] img')) img.remove();
  return doc.body.innerHTML;
}

export function cleanDocument(doc, url) {
  absolutizeUrls(doc, url);
  const article = new globalThis.Readability(doc.cloneNode(true)).parse();
  const articleText = article?.textContent?.trim() ?? '';
  const useArticle = articleText.length >= MIN_TEXT_LENGTH;
  const fallback = useArticle ? null : fallbackContent(doc);
  return {
    url,
    title: article?.title?.trim() || doc.title?.trim() || url,
    byline: article?.byline ?? null,
    contentHtml: stripTrackers(useArticle ? article.content : fallback.html),
    textLength: useArticle ? articleText.length : fallback.text.length,
  };
}
