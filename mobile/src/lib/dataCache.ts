/** Bounded, session-scoped cache shared by routes and data repositories. */
export class DataCache {
  private entries = new Map<string, { value: unknown; expires: number }>();
  private pending = new Map<string, Promise<unknown>>();
  private epoch = 0;
  private observer?: (event: { resource: string; state: string; durationMs: number }) => void;
  observe(observer: typeof this.observer): void {
    this.observer = observer;
  }
  private report(key: string, state: string, start: number) {
    this.observer?.({ resource: key.split(":")[0], state, durationMs: this.now() - start });
  }
  constructor(
    private readonly capacity = 160,
    private readonly now = Date.now,
  ) {}

  peek<T>(key: string): T | undefined {
    return this.entries.get(key)?.value as T | undefined;
  }

  revision(): number {
    return this.epoch;
  }

  fresh(key: string): boolean {
    return (this.entries.get(key)?.expires ?? 0) > this.now();
  }

  async read<T>(key: string, load: () => Promise<T>, ttl = 30_000): Promise<T> {
    const start = this.now();
    const cached = this.entries.get(key);
    if (cached && cached.expires > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      this.report(key, "hit", start);
      return cached.value as T;
    }
    const underway = this.pending.get(key);
    if (underway) {
      this.report(key, "shared", start);
      return underway as Promise<T>;
    }
    const epoch = this.epoch;
    const request = Promise.resolve()
      .then(load)
      .then((value) => {
        // An old account/request must never repopulate an invalidated cache.
        if (epoch === this.epoch) {
          this.entries.delete(key);
          this.entries.set(key, { value, expires: this.now() + ttl });
          while (this.entries.size > this.capacity)
            this.entries.delete(this.entries.keys().next().value!);
        }
        this.report(key, "load", start);
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return request;
  }

  invalidate(clear = false): void {
    this.epoch++;
    this.pending.clear();
    if (clear) this.entries.clear();
    else for (const entry of this.entries.values()) entry.expires = 0;
  }
}

export const dataCache = new DataCache();
let sessionRevision = 0;
export const dataSessionRevision = () => sessionRevision;
const listeners = new Set<() => void>();
export function onDataInvalidated(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function invalidateData(): void {
  dataCache.invalidate();
  listeners.forEach((listener) => listener());
}
export function clearSessionData(): void {
  sessionRevision++;
  dataCache.invalidate(true);
}

/** Call after a successful trusted/direct write, before refreshing the affected screen. */
export async function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = await operation();
  invalidateData();
  return result;
}
