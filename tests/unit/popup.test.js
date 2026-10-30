import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const ARTICLE = `<html><head><title>Alpha</title></head><body><article><p>${'Words here. '.repeat(40)}</p></article></body></html>`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const $ = (id) => document.getElementById(id);

function fakeBrowser() {
  const data = {};
  return {
    created: [],
    badge: null,
    storage: { session: {
      async get(keys) {
        const list = [keys].flat();
        return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
      },
      async set(items) { Object.assign(data, structuredClone(items)); },
      async remove(keys) { for (const k of [keys].flat()) delete data[k]; },
    } },
    tabs: {
      query: async () => [{ id: 7, index: 0, url: 'https://site.test/a' }],
      async create({ url }) { this.owner.created.push(url); },
    },
    action: { async setBadgeText({ text }) { this.owner.badge = text; } },
    scripting: { executeScript: async () => [{ result: { url: 'https://site.test/a', html: ARTICLE } }] },
    permissions: { request: vi.fn(async () => true) },
    runtime: { getURL: (path) => `ext://x/${path}` },
  };
}

async function openPopup() {
  document.body.innerHTML = readFileSync('extension/popup/popup.html', 'utf8').match(/<body>([\s\S]*)<\/body>/)[1];
  const api = fakeBrowser();
  api.tabs.owner = api;
  api.action.owner = api;
  globalThis.browser = api;
  window.close = () => {};
  vi.resetModules();
  await import('../../extension/popup/popup.js');
  const form = $('options');
  form.elements.mode.value = 'collect';
  form.dispatchEvent(new Event('change'));
  return api;
}

describe('popup collection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('clears the duplicate note after the page is removed', async () => {
    await openPopup();
    $('add').click();
    await tick();
    expect($('note').textContent).toBe('This page is already in the list');
    $('pages').querySelector('button').click();
    await tick();
    expect($('add').disabled).toBe(false);
    expect($('note').textContent).toBe('');
  });

  it('Save PDF opens the capture tab without a permission prompt', async () => {
    const api = await openPopup();
    $('add').click();
    await tick();
    $('save-collection').click();
    await tick();
    expect(api.permissions.request).not.toHaveBeenCalled();
    expect(api.created).toEqual(['ext://x/capture/capture.html?mode=collection&report=1']);
  });
});
