import { expect, test } from 'vitest';
import { SaveQueue } from './save-queue';

test('serializes writes without dropping later work', async () => {
  const q = new SaveQueue(); const events: number[] = [];
  const a = q.enqueue(async () => { events.push(1); });
  const b = q.enqueue(async () => { events.push(2); });
  await Promise.all([a,b]); await q.drain();
  expect(events).toEqual([1,2]);
});

test('does not start the next job before the previous one settles', async () => {
  const q = new SaveQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let secondRan = false;
  const first = q.enqueue(async () => { await gate; });
  const second = q.enqueue(async () => { secondRan = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(secondRan).toBe(false);
  release();
  await Promise.all([first, second]);
  expect(secondRan).toBe(true);
});

test('failed job reports its error but does not poison scheduling', async () => {
  const q = new SaveQueue();
  const boom = q.enqueue(async () => { throw new Error('boom'); });
  await expect(boom).rejects.toThrow('boom');
  const events: number[] = [];
  await q.enqueue(async () => { events.push(1); });
  const retry = q.enqueue(async () => { throw new Error('still broken'); });
  await expect(retry).rejects.toThrow('still broken');
  await q.enqueue(async () => { events.push(2); });
  await q.drain();
  expect(events).toEqual([1, 2]);
});

test('drain resolves after all enqueued jobs including failures', async () => {
  const q = new SaveQueue();
  q.enqueue(async () => { throw new Error('ignored'); }).catch(() => undefined);
  let done = false;
  q.enqueue(async () => { done = true; });
  await q.drain();
  expect(done).toBe(true);
});
