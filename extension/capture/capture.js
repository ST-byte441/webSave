import { renderDocument } from '../lib/assembler.js';
import { captureTab, createPageCapturer, renderInBackgroundTab } from '../lib/capturer.js';
import { cleanDocument } from '../lib/cleaner.js';
import { loadPages } from '../lib/collection.js';
import { crawl } from '../lib/crawler.js';
import { embedImages } from '../lib/images.js';

const params = new URLSearchParams(location.search);
const options = {
  tabId: Number(params.get('tabId')),
  mode: params.get('mode'),
  depth: Number(params.get('depth')),
  maxPages: Number(params.get('maxPages')),
  scope: params.get('scope'),
  includeReport: params.get('report') === '1',
};

const byId = (id) => document.getElementById(id);
const setStatus = (text) => {
  byId('status').textContent = text;
};

let controller = new AbortController();
byId('cancel').addEventListener('click', () => controller.abort());

const credentialedFetch = (url, init = {}) => fetch(url, { ...init, credentials: 'include' });

async function closeThisTab() {
  const tab = await browser.tabs.getCurrent();
  await browser.tabs.remove(tab.id);
}

function askAfterCancel(pageCount) {
  const pagesLabel = pageCount === 1 ? '1 page' : `${pageCount} pages`;
  byId('cancel').hidden = true;
  byId('cancelled').hidden = false;
  byId('cancelled-text').textContent = `Cancelled. ${pagesLabel} captured so far.`;
  byId('make-pdf').textContent = `Make PDF from ${pagesLabel}`;
  return new Promise((resolve) => {
    byId('make-pdf').onclick = () => {
      byId('cancelled').hidden = true;
      byId('cancel').hidden = false;
      resolve(true);
    };
    byId('discard').onclick = () => resolve(false);
  });
}

const ALL_SITES = { origins: ['<all_urls>'] };

async function ensureAllSitesAccess() {
  if (await browser.permissions.contains(ALL_SITES)) return true;
  byId('cancel').hidden = true;
  byId('access').hidden = false;
  const granted = await new Promise((resolve) => {
    // The request must be the first browser call in the click handler.
    byId('allow-access').onclick = () => browser.permissions.request(ALL_SITES).then(resolve, () => resolve(false));
    byId('skip-access').onclick = () => resolve(false);
  });
  byId('access').hidden = true;
  byId('cancel').hidden = false;
  return granted;
}

async function waitForRender() {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
}

async function run() {
  const capturedAt = new Date();
  let pages;
  let failures = [];
  if (options.mode === 'collection') {
    setStatus('Loading saved pages…');
    pages = await loadPages(browser.storage.session);
    if (pages.length === 0) throw new Error('The collection is empty.');
    if (!(await ensureAllSitesAccess())) byId('warning').hidden = false;
  } else {
    setStatus('Capturing the current page…');
    pages = [await captureTab(browser, options.tabId, cleanDocument)];
  }

  if (options.mode === 'crawl') {
    const capturePage = createPageCapturer({
      fetchFn: credentialedFetch,
      renderInTab: (url, signal) => renderInBackgroundTab(browser, url, { signal }),
      clean: cleanDocument,
    });
    const result = await crawl({
      start: pages[0],
      options,
      capturePage,
      signal: controller.signal,
      onProgress: ({ done, total }) => setStatus(`Fetching ${done}/${total}`),
    });
    ({ pages, failures } = result);
    if (result.cancelled) {
      if (!(await askAfterCancel(pages.length))) return closeThisTab();
      controller = new AbortController();
    }
  }

  const images = await embedImages(pages, {
    fetchFn: credentialedFetch,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    signal: controller.signal,
    onProgress: ({ done, total }) => setStatus(`Downloading images ${done}/${total}`),
  });
  if (controller.signal.aborted && !(await askAfterCancel(pages.length))) return closeThisTab();

  setStatus('Building the document…');
  renderDocument(document, {
    pages: images.pages,
    capturedAt,
    report: options.includeReport
      ? { failures, imageFailures: images.failures, warnings: images.warnings }
      : null,
  });
  await waitForRender();
  window.print();
}

run().catch((error) => {
  byId('error').hidden = false;
  byId('error').textContent = `Could not capture this page: ${error.reason ?? error.message}`;
  byId('cancel').hidden = true;
  setStatus('Stopped.');
});
