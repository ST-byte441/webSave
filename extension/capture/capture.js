import { renderDocument } from '../lib/assembler.js';
import { captureTab, createPageCapturer, renderInBackgroundTab } from '../lib/capturer.js';
import { cleanDocument } from '../lib/cleaner.js';
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

async function waitForRender() {
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
}

async function run() {
  const capturedAt = new Date();
  setStatus('Capturing the current page…');
  const start = await captureTab(browser, options.tabId, cleanDocument);

  let pages = [start];
  let failures = [];
  if (options.mode === 'crawl') {
    const capturePage = createPageCapturer({
      fetchFn: credentialedFetch,
      renderInTab: (url, signal) => renderInBackgroundTab(browser, url, { signal }),
      clean: cleanDocument,
    });
    const result = await crawl({
      start,
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
