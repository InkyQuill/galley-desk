/**
 * Serializes async jobs in submission order. A failed job rejects its own
 * promise but never poisons the queue: scheduling of later jobs (including
 * explicit retries of the failed work) continues unchanged.
 */
export class SaveQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  drain(): Promise<void> {
    return this.tail;
  }
}
