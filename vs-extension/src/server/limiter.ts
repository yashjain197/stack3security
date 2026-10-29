export class BusyError extends Error {
  constructor() {
    super('busy');
    this.name = 'BusyError';
  }
}

export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  stats(): { running: number; queued: number };
}

/** At most `max` tasks at once, `maxQueue` more waiting; anything beyond that is refused at once instead of piling up. */
export function createLimiter(max: number, maxQueue: number): Limiter {
  let running = 0;
  const waiting: (() => void)[] = [];

  const release = () => {
    running--;
    waiting.shift()?.();
  };

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (running >= max) {
        if (waiting.length >= maxQueue) throw new BusyError();
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      running++;
      try {
        return await task();
      } finally {
        release();
      }
    },
    stats: () => ({ running, queued: waiting.length }),
  };
}
