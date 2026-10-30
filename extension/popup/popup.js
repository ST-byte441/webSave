import { CaptureError, captureTab, isRestrictedUrl } from '../lib/capturer.js';
import { cleanDocument } from '../lib/cleaner.js';
import {
  CollectionError, addPage, badgeText, clearPages, hasPage, listEntries, removePage,
} from '../lib/collection.js';

const form = document.getElementById('options');
const save = document.getElementById('save');
const note = document.getElementById('note');
const crawlOptions = document.getElementById('crawl-options');
const byId = (id) => document.getElementById(id);
const area = browser.storage.session;

const clamp = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const pagesLabel = (n) => (n === 1 ? '1 page' : `${n} pages`);

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
const restricted = !tab?.url || isRestrictedUrl(tab.url);
if (!restricted) {
  save.disabled = false;
} else {
  note.textContent = "This page can't be saved. Browsers don't let extensions read built-in pages, extension stores or PDF files.";
}

let busy = false;

async function renderCollection() {
  const entries = await listEntries(area);
  byId('count').textContent = `${pagesLabel(entries.length)} saved`;
  byId('pages').replaceChildren(...entries.map((entry) => {
    const title = document.createElement('span');
    title.textContent = entry.title;
    title.title = entry.url;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', `Remove ${entry.title}`);
    remove.disabled = busy;
    remove.addEventListener('click', () => update(() => removePage(area, entry.id)));
    const item = document.createElement('li');
    item.append(title, remove);
    return item;
  }));
  byId('save-collection').textContent = `Save PDF (${pagesLabel(entries.length)})`;
  byId('save-collection').disabled = busy || entries.length === 0;
  byId('discard').disabled = busy || entries.length === 0;
  const alreadyAdded = !restricted && await hasPage(area, tab.url);
  byId('add').disabled = busy || restricted || alreadyAdded;
  if (alreadyAdded) note.textContent = 'This page is already in the list';
  await browser.action.setBadgeText({ text: badgeText(entries.length) });
  return entries;
}

async function update(change) {
  busy = true;
  await renderCollection();
  try {
    await change();
  } finally {
    busy = false;
    await renderCollection();
  }
}

function showMode() {
  const collecting = form.elements.mode.value === 'collect';
  crawlOptions.disabled = form.elements.mode.value !== 'crawl';
  crawlOptions.hidden = collecting;
  save.hidden = collecting;
  byId('collection').hidden = !collecting;
  byId('collection-actions').hidden = !collecting;
}

if ((await renderCollection()).length > 0) form.elements.mode.value = 'collect';
showMode();

form.addEventListener('change', showMode);

byId('add').addEventListener('click', () => {
  byId('add').textContent = 'Adding…';
  note.textContent = '';
  update(async () => {
    try {
      await addPage(area, await captureTab(browser, tab.id, cleanDocument));
    } catch (error) {
      if (error instanceof CollectionError) {
        note.textContent = error.reason === 'full' ? 'Collection is full — save or remove pages' : 'This page is already in the list';
      } else {
        note.textContent = `Could not capture this page: ${error instanceof CaptureError ? error.reason : error.message}`;
      }
    } finally {
      byId('add').textContent = 'Add this page';
    }
  });
});

byId('discard').addEventListener('click', async () => {
  const entries = await listEntries(area);
  byId('confirm-text').textContent = `Discard ${pagesLabel(entries.length)}?`;
  byId('confirm').hidden = false;
});
byId('confirm-keep').addEventListener('click', () => {
  byId('confirm').hidden = true;
});
byId('confirm-discard').addEventListener('click', () => {
  byId('confirm').hidden = true;
  note.textContent = '';
  update(() => clearPages(area));
});

byId('save-collection').addEventListener('click', () => {
  const report = form.elements.report.checked ? '1' : '0';
  // This must be the first browser call in the handler: Firefox only shows
  // the permission prompt while it is still handling the click.
  browser.permissions.request({ origins: ['<all_urls>'] })
    .then((granted) => openCollection(report, granted), () => openCollection(report, false));
});

async function openCollection(report, granted) {
  const params = new URLSearchParams({ mode: 'collection', report, access: granted ? '1' : '0' });
  await browser.tabs.create({ url: browser.runtime.getURL(`capture/capture.html?${params}`), index: tab.index + 1 });
  window.close();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (form.elements.mode.value === 'collect') return;
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
