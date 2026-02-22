/**
 * Thumbnail request queue: limits concurrent thumbnail generation
 * so many large videos don't overload the main thread.
 */
const CONCURRENCY = 1;

let running = 0;
const queue: Array<() => void> = [];

function runNext(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    if (job) {
      running++;
      job();
    }
  }
}

export function enqueueThumbnail<T>(factory: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job = () => {
      factory()
        .then(resolve, reject)
        .finally(() => {
          running--;
          runNext();
        });
    };
    queue.push(job);
    runNext();
  });
}
