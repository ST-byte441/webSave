import { describe, it, expect } from 'vitest';
import { createLimiter } from '../../extension/lib/concurrency.js';

describe('createLimiter', () => {
  it('never runs more than max tasks at once', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = () => limit(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });

  it('starts tasks in the order they were added and returns their results', async () => {
    const limit = createLimiter(1);
    const started = [];
    const results = await Promise.all([1, 2, 3].map((n) => limit(async () => {
      started.push(n);
      return n * 10;
    })));
    expect(started).toEqual([1, 2, 3]);
    expect(results).toEqual([10, 20, 30]);
  });

  it('keeps going after a task fails', async () => {
    const limit = createLimiter(1);
    const failed = limit(async () => { throw new Error('boom'); });
    const ok = limit(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('ok');
  });
});
