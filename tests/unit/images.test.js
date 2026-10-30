import { describe, it, expect, vi } from 'vitest';
import { embedImages, pickImageSource } from '../../extension/lib/images.js';

const imgFrom = (html) => new DOMParser().parseFromString(html, 'text/html').querySelector('img');
const page = (url, contentHtml) => ({ url, title: url, contentHtml });

function imageResponse(size = 100, type = 'image/png', status = 200, extraHeaders = []) {
  return { ok: status < 400, status, headers: new Map([['content-type', type], ...extraHeaders]), blob: async () => ({ size, type }) };
}

function fakeObjectUrls() {
  let count = 0;
  return vi.fn(() => `blob:test/${++count}`);
}

describe('pickImageSource', () => {
  it('prefers the largest srcset candidate', () => {
    expect(pickImageSource(imgFrom('<img src="https://x.com/s.png" srcset="https://x.com/m.png 800w, https://x.com/l.png 1600w">'))).toBe('https://x.com/l.png');
  });

  it('uses lazy-load attributes when src is a placeholder or missing', () => {
    expect(pickImageSource(imgFrom('<img src="data:image/gif;base64,R0lG" data-src="https://x.com/real.png">'))).toBe('https://x.com/real.png');
    expect(pickImageSource(imgFrom('<img src="https://x.com/placeholder.svg" data-original="https://x.com/o.png">'))).toBe('https://x.com/o.png');
    expect(pickImageSource(imgFrom('<img data-lazy-src="https://x.com/lazy.png">'))).toBe('https://x.com/lazy.png');
  });

  it('falls back to src, keeps inline data images, and returns null when there is nothing', () => {
    expect(pickImageSource(imgFrom('<img src="https://x.com/a.png">'))).toBe('https://x.com/a.png');
    expect(pickImageSource(imgFrom('<img src="data:image/png;base64,AAAA">'))).toBe('data:image/png;base64,AAAA');
    expect(pickImageSource(imgFrom('<img alt="nothing">'))).toBeNull();
  });
});

describe('embedImages', () => {
  it('downloads each URL once and embeds it on every page', async () => {
    const fetchFn = vi.fn(async () => imageResponse());
    const createObjectURL = fakeObjectUrls();
    const result = await embedImages([
      page('https://x.com/1', '<img src="https://x.com/a.png" srcset="https://x.com/a.png 1x" loading="lazy">'),
      page('https://x.com/2', '<p><img src="https://x.com/a.png"></p>'),
    ], { fetchFn, createObjectURL });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.pages[0].contentHtml).toBe('<img src="blob:test/1">');
    expect(result.pages[1].contentHtml).toBe('<p><img src="blob:test/1"></p>');
    expect(result.failures).toEqual([]);
  });

  it('replaces failed images with a labeled placeholder', async () => {
    const result = await embedImages([page('https://x.com/1', '<img src="https://x.com/gone.png" alt="Chart">')], {
      fetchFn: async () => imageResponse(100, 'image/png', 404),
      createObjectURL: fakeObjectUrls(),
    });
    const doc = new DOMParser().parseFromString(result.pages[0].contentHtml, 'text/html');
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('.img-missing').textContent).toContain('Image unavailable: Chart (HTTP 404)');
    expect(doc.querySelector('.img-url').textContent).toBe('https://x.com/gone.png');
    expect(result.failures).toEqual([{ pageUrl: 'https://x.com/1', imageUrl: 'https://x.com/gone.png', reason: 'HTTP 404' }]);
  });

  it('rejects responses that are not images, such as a login page', async () => {
    const result = await embedImages([page('https://x.com/1', '<img src="https://x.com/a.png">')], {
      fetchFn: async () => imageResponse(500, 'text/html; charset=utf-8'),
      createObjectURL: fakeObjectUrls(),
    });
    expect(result.failures[0].reason).toBe('not an image (text/html; charset=utf-8)');
    expect(result.pages[0].contentHtml).toContain('img-missing');
  });

  it('skips images over the per-image limit', async () => {
    const result = await embedImages([page('https://x.com/1', '<img src="https://x.com/big.png">')], {
      fetchFn: async () => imageResponse(5000),
      createObjectURL: fakeObjectUrls(),
      maxImageBytes: 1000,
    });
    expect(result.failures[0].reason).toContain('too large');
  });

  it('stops embedding at the total limit and warns once', async () => {
    const html = ['a', 'b', 'c', 'd'].map((n) => `<img src="https://x.com/${n}.png">`).join('');
    const result = await embedImages([page('https://x.com/1', html)], {
      fetchFn: async () => imageResponse(100),
      createObjectURL: fakeObjectUrls(),
      maxTotalBytes: 250,
      concurrency: 1,
    });
    expect(result.failures.map((f) => f.imageUrl)).toEqual(['https://x.com/c.png', 'https://x.com/d.png']);
    expect(result.failures[0].reason).toBe('total image limit reached');
    expect(result.warnings).toHaveLength(1);
  });

  it('removes picture sources, keeps data images, and marks images with no source', async () => {
    const fetchFn = vi.fn(async () => imageResponse());
    const result = await embedImages([page('https://x.com/1',
      '<picture><source srcset="https://x.com/a.webp"><img src="https://x.com/a.png"></picture><img src="data:image/png;base64,AAAA"><img alt="Empty">')],
    { fetchFn, createObjectURL: fakeObjectUrls() });
    const html = result.pages[0].contentHtml;
    expect(html).not.toContain('<source');
    expect(html).toContain('<picture><img src="blob:test/1"></picture>');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('Image unavailable: Empty (no image source)');
  });

  it('runs at most 4 downloads at once and reports progress', async () => {
    let active = 0;
    let peak = 0;
    const fetchFn = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return imageResponse();
    };
    const onProgress = vi.fn();
    const html = [1, 2, 3, 4, 5, 6].map((n) => `<img src="https://x.com/${n}.png">`).join('');
    await embedImages([page('https://x.com/1', html)], { fetchFn, createObjectURL: fakeObjectUrls(), onProgress });
    expect(peak).toBe(4);
    expect(onProgress).toHaveBeenLastCalledWith({ done: 6, total: 6 });
  });

  it('marks remaining images as cancelled after abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await embedImages([page('https://x.com/1', '<img src="https://x.com/a.png">')], {
      fetchFn: async () => imageResponse(),
      createObjectURL: fakeObjectUrls(),
      signal: controller.signal,
    });
    expect(result.failures[0].reason).toBe('cancelled');
  });

  it('times out a stalled image download', async () => {
    const hang = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const result = await embedImages([page('https://x.com/1', '<img src="https://x.com/slow.png">')], {
      fetchFn: hang,
      createObjectURL: fakeObjectUrls(),
      timeoutMs: 10,
    });
    expect(result.failures[0].reason).toBe('timeout');
  });

  it('rejects an oversized image from its content-length without downloading the body', async () => {
    const response = imageResponse(0, 'image/png', 200, [['content-length', '5000']]);
    response.blob = vi.fn(async () => ({ size: 5000 }));
    const result = await embedImages([page('https://x.com/1', '<img src="https://x.com/big.png">')], {
      fetchFn: async () => response,
      createObjectURL: fakeObjectUrls(),
      maxImageBytes: 1000,
    });
    expect(result.failures[0].reason).toContain('too large');
    expect(response.blob).not.toHaveBeenCalled();
  });
});
