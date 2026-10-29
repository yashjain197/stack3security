import { describe, expect, test } from 'vitest';
import { BusyError, createLimiter } from '../../src/server/limiter';

const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};

describe('limiter', () => {
  test('runs at most N at a time and the rest wait their turn', async () => {
    const lim = createLimiter(2, 10);
    let running = 0;
    let peak = 0;
    const g = gate();
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await g.p;
      running--;
    };
    const all = Promise.all([1, 2, 3, 4, 5].map(() => lim.run(task)));
    await new Promise((r) => setTimeout(r, 10));
    expect(running).toBe(2);
    g.open();
    await all;
    expect(peak).toBe(2);
  });
  test('when the queue is full the next caller is told it is busy, immediately', async () => {
    const lim = createLimiter(1, 1);
    const g = gate();
    const a = lim.run(() => g.p); // running
    const b = lim.run(async () => 'queued'); // waiting
    await expect(lim.run(async () => 'x')).rejects.toBeInstanceOf(BusyError);
    g.open();
    await a;
    expect(await b).toBe('queued');
  });
  test('a failed task frees its slot', async () => {
    const lim = createLimiter(1, 0);
    await expect(lim.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await lim.run(async () => 'ok')).toBe('ok');
  });
  test('reports its load', async () => {
    const lim = createLimiter(1, 5);
    const g = gate();
    const a = lim.run(() => g.p);
    void lim.run(async () => undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(lim.stats()).toEqual({ running: 1, queued: 1 });
    g.open();
    await a;
  });
});
