import { describe, it, expect } from 'vitest';
import {
  CollectionError, addPage, badgeText, clearPages, hasPage, listEntries, loadPages, removePage,
} from '../../extension/lib/collection.js';

function fakeArea({ quotaBytes = Infinity } = {}) {
  const data = {};
  return {
    data,
    async get(keys) {
      const list = keys == null ? Object.keys(data) : [keys].flat();
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      if (JSON.stringify({ ...data, ...items }).length > quotaBytes) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const k of [keys].flat()) delete data[k];
    },
  };
}

const page = (url, title = url, contentHtml = '<p>text</p>') => ({
  url, requestedUrl: url, title, byline: null, contentHtml, textLength: 4, method: 'tab', capturedAt: '2026-10-30T00:00:00.000Z',
});

async function reasonOf(promise) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CollectionError);
    return error.reason;
  }
  throw new Error('expected a CollectionError');
}

const pageKeys = (area) => Object.keys(area.data).filter((k) => k.startsWith('collection:page:'));

describe('collection', () => {
  it('adds pages and lists them in added order', async () => {
    const area = fakeArea();
    const one = page('https://a.com/1', 'One');
    const two = page('https://b.com/2', 'Two');
    await addPage(area, one);
    expect(await addPage(area, two)).toMatchObject({ count: 2 });
    expect((await listEntries(area)).map((e) => e.title)).toEqual(['One', 'Two']);
    expect(await loadPages(area)).toEqual([one, two]);
  });

  it('rejects a page whose urlKey is already collected', async () => {
    const area = fakeArea();
    await addPage(area, page('https://a.com/doc'));
    expect(await reasonOf(addPage(area, page('https://a.com/doc#part')))).toBe('duplicate');
    expect(await listEntries(area)).toHaveLength(1);
  });

  it('hasPage matches by urlKey', async () => {
    const area = fakeArea();
    await addPage(area, page('https://a.com/doc'));
    expect(await hasPage(area, 'https://a.com/doc#x')).toBe(true);
    expect(await hasPage(area, 'https://a.com/other')).toBe(false);
  });

  it('refuses a page that would exceed the budget and leaves the collection unchanged', async () => {
    const area = fakeArea();
    await addPage(area, page('https://a.com/small'), { budgetBytes: 2000 });
    const big = page('https://a.com/big', 'Big', `<img src="data:image/png;base64,${'A'.repeat(5000)}">`);
    expect(await reasonOf(addPage(area, big, { budgetBytes: 2000 }))).toBe('full');
    expect(await listEntries(area)).toHaveLength(1);
    expect(pageKeys(area)).toHaveLength(1);
    expect(Object.keys(area.data)).toHaveLength(2);
  });

  it('counts size in UTF-8 bytes', async () => {
    const area = fakeArea();
    const japanese = page('https://a.com/jp', '日本語');
    await addPage(area, japanese);
    const [entry] = await listEntries(area);
    expect(entry.size).toBe(new TextEncoder().encode(JSON.stringify(japanese)).length);
  });

  it('cleans up and reports full when the storage write throws', async () => {
    const area = fakeArea({ quotaBytes: 1500 });
    expect(await reasonOf(addPage(area, page('https://a.com/x', 'X', `<p>${'x'.repeat(3000)}</p>`)))).toBe('full');
    expect(pageKeys(area)).toHaveLength(0);
    expect(area.data['collection:index'] ?? []).toHaveLength(0);
  });

  it('removePage removes one page and returns the remaining count', async () => {
    const area = fakeArea();
    await addPage(area, page('https://a.com/1', 'First'));
    const { id } = await addPage(area, page('https://a.com/2', 'Middle'));
    await addPage(area, page('https://a.com/3', 'Third'));
    expect(await removePage(area, id)).toBe(2);
    expect((await listEntries(area)).map((e) => e.title)).toEqual(['First', 'Third']);
    expect(area.data).not.toHaveProperty(`collection:page:${id}`);
  });

  it('clearPages removes every collection key', async () => {
    const area = fakeArea();
    await addPage(area, page('https://a.com/1'));
    await addPage(area, page('https://a.com/2'));
    await clearPages(area);
    expect(Object.keys(area.data).filter((k) => k.startsWith('collection:'))).toEqual([]);
    expect(await listEntries(area)).toEqual([]);
  });

  it('loadPages skips index entries whose page is missing', async () => {
    const area = fakeArea();
    const { id } = await addPage(area, page('https://a.com/1', 'One'));
    const two = page('https://a.com/2', 'Two');
    await addPage(area, two);
    delete area.data[`collection:page:${id}`];
    expect(await loadPages(area)).toEqual([two]);
  });

  it('badgeText returns an empty string for zero', () => {
    expect(badgeText(0)).toBe('');
    expect(badgeText(3)).toBe('3');
  });
});
