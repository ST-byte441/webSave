import { urlKey } from './crawler.js';

export const COLLECTION_BUDGET_BYTES = 8 * 1024 * 1024;
const INDEX_KEY = 'collection:index';
const pageKey = (id) => `collection:page:${id}`;

export class CollectionError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'CollectionError';
    this.reason = reason;
  }
}

export async function listEntries(area) {
  const { [INDEX_KEY]: index = [] } = await area.get(INDEX_KEY);
  return index;
}

export async function loadPages(area) {
  const index = await listEntries(area);
  if (index.length === 0) return [];
  const stored = await area.get(index.map((entry) => pageKey(entry.id)));
  return index.map((entry) => stored[pageKey(entry.id)]).filter(Boolean);
}

export async function hasPage(area, url) {
  const key = urlKey(url);
  return (await listEntries(area)).some((entry) => urlKey(entry.url) === key);
}

export async function addPage(area, page, { budgetBytes = COLLECTION_BUDGET_BYTES } = {}) {
  const index = await listEntries(area);
  const key = urlKey(page.url);
  if (index.some((entry) => urlKey(entry.url) === key)) throw new CollectionError('duplicate');
  const size = new TextEncoder().encode(JSON.stringify(page)).length;
  const used = index.reduce((total, entry) => total + entry.size, 0);
  if (used + size > budgetBytes) throw new CollectionError('full');

  const id = crypto.randomUUID();
  try {
    await area.set({ [pageKey(id)]: page });
    await area.set({ [INDEX_KEY]: [...index, { id, url: page.url, title: page.title, size }] });
  } catch {
    await area.remove(pageKey(id)).catch(() => {});
    throw new CollectionError('full');
  }
  return { id, count: index.length + 1 };
}

export async function removePage(area, id) {
  const index = (await listEntries(area)).filter((entry) => entry.id !== id);
  await area.set({ [INDEX_KEY]: index });
  await area.remove(pageKey(id));
  return index.length;
}

export async function clearPages(area) {
  const index = await listEntries(area);
  await area.remove([INDEX_KEY, ...index.map((entry) => pageKey(entry.id))]);
}

export function badgeText(count) {
  return count ? String(count) : '';
}
