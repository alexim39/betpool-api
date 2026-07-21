const cache = new Map<string, { data: any; expiry: number }>();
const DEFAULT_TTL = 30_000; // 30 seconds

export const cacheService = {
  get<T>(key: string): T | null {
    const entry = cache.get(key);
    if (!entry || Date.now() > entry.expiry) {
      cache.delete(key);
      return null;
    }
    return entry.data as T;
  },
  set(key: string, data: any, ttl = DEFAULT_TTL) {
    cache.set(key, { data, expiry: Date.now() + ttl });
  },
  clear(pattern?: string) {
    if (!pattern) {
      cache.clear();
      return;
    }
    for (const key of cache.keys()) {
      if (key.startsWith(pattern)) cache.delete(key);
    }
  }
};
