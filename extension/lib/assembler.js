import { urlKey } from './crawler.js';

export function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function documentTitle(title, date) {
  return `${title} - ${formatDate(date)}`;
}

function el(doc, tag, attributes = {}, ...children) {
  const node = doc.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function titlePage(doc, pages, capturedAt) {
  return el(doc, 'section', { class: 'title-page' },
    el(doc, 'h1', {}, pages[0].title),
    el(doc, 'p', { class: 'source' }, pages[0].url),
    el(doc, 'p', {}, `Captured ${formatDate(capturedAt)}`),
    el(doc, 'p', {}, pages.length === 1 ? '1 page' : `${pages.length} pages`));
}

function tableOfContents(doc, pages) {
  const list = el(doc, 'ol');
  pages.forEach((page, i) => list.append(el(doc, 'li', {}, el(doc, 'a', { href: `#page-${i + 1}` }, page.title))));
  return el(doc, 'nav', { class: 'toc' }, el(doc, 'h2', {}, 'Contents'), list);
}

function pageSection(doc, page, id, anchors) {
  const content = new DOMParser().parseFromString(page.contentHtml, 'text/html').body;
  for (const link of content.querySelectorAll('a[href]')) {
    let key;
    try {
      key = urlKey(link.getAttribute('href'));
    } catch {
      continue;
    }
    if (anchors.has(key)) link.setAttribute('href', `#${anchors.get(key)}`);
  }
  const body = el(doc, 'div', { class: 'page-content' });
  body.append(...[...content.childNodes].map((node) => doc.importNode(node, true)));
  return el(doc, 'section', { class: 'page', id },
    el(doc, 'h1', {}, page.title),
    el(doc, 'p', { class: 'source' }, page.url),
    body);
}

function captureReport(doc, pages, { failures, imageFailures, warnings }) {
  const section = el(doc, 'section', { class: 'report' }, el(doc, 'h2', {}, 'Capture report'));
  const addList = (heading, items) => {
    if (items.length === 0) return;
    section.append(el(doc, 'h3', {}, heading), el(doc, 'ul', {}, ...items.map((item) => el(doc, 'li', {}, item))));
  };
  addList('Captured pages', pages.map((page) => `${page.url} (${page.method}, ${page.capturedAt})`));
  addList('Skipped pages', failures.map((failure) => `${failure.url}: ${failure.reason}`));
  addList('Missing images', imageFailures.map((failure) => `${failure.imageUrl} on ${failure.pageUrl}: ${failure.reason}`));
  addList('Warnings', warnings);
  return section;
}

export function renderDocument(doc, { pages, capturedAt, report }) {
  const anchors = new Map();
  pages.forEach((page, i) => {
    anchors.set(urlKey(page.url), `page-${i + 1}`);
    if (page.requestedUrl) anchors.set(urlKey(page.requestedUrl), `page-${i + 1}`);
  });

  doc.title = documentTitle(pages[0].title, capturedAt);
  doc.body.className = 'document';
  doc.body.replaceChildren(titlePage(doc, pages, capturedAt));
  if (pages.length > 1) doc.body.append(tableOfContents(doc, pages));
  pages.forEach((page, i) => doc.body.append(pageSection(doc, page, `page-${i + 1}`, anchors)));
  if (report) doc.body.append(captureReport(doc, pages, report));
}
