import { isRestrictedUrl } from '../lib/capturer.js';

const form = document.getElementById('options');
const save = document.getElementById('save');
const note = document.getElementById('note');
const crawlOptions = document.getElementById('crawl-options');

const clamp = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
if (tab?.url && !isRestrictedUrl(tab.url)) {
  save.disabled = false;
} else {
  note.textContent = "This page can't be saved. Browsers don't let extensions read built-in pages, extension stores or PDF files.";
}

form.addEventListener('change', () => {
  crawlOptions.disabled = form.elements.mode.value !== 'crawl';
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const options = {
    mode: data.get('mode') === 'crawl' ? 'crawl' : 'single',
    depth: clamp(data.get('depth'), 1, 3, 1),
    maxPages: clamp(data.get('maxPages'), 1, 100, 20),
    scope: data.get('scope') === 'domain' ? 'domain' : 'prefix',
    report: data.get('report') ? '1' : '0',
  };
  // This must be the first browser call in the handler: Firefox only shows
  // the permission prompt while it is still handling the click.
  browser.permissions.request({ origins: ['<all_urls>'] })
    .then((granted) => start(options, granted), () => start(options, false));
});

async function start(options, granted) {
  if (options.mode === 'crawl' && !granted) {
    note.textContent = 'Saving linked pages needs access to all sites. Allow access, or choose "This page".';
    return;
  }
  const params = new URLSearchParams({ tabId: tab.id, ...options });
  await browser.tabs.create({ url: browser.runtime.getURL(`capture/capture.html?${params}`), index: tab.index + 1 });
  window.close();
}
