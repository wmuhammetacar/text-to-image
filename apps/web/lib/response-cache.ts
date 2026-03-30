interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
}

class InMemoryTtlCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  public get<T>(key: string, nowMs: number): T | null {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAtMs <= nowMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.value as T;
  }

  public set<T>(key: string, value: T, ttlMs: number, nowMs: number): void {
    if (ttlMs <= 0) {
      return;
    }
    this.entries.set(key, {
      value,
      expiresAtMs: nowMs + ttlMs,
    });
  }

  public reset(): void {
    this.entries.clear();
  }
}

const cacheSingleton = new InMemoryTtlCache();

function buildVersionedKey(params: {
  namespace: "public_gallery" | "public_generation";
  rawKey: string;
}): string {
  return `${params.namespace}:v1:${params.rawKey}`;
}

export async function getOrSetCachedResponse<T>(params: {
  namespace: "public_gallery" | "public_generation";
  key: string;
  ttlSeconds: number;
  producer: () => Promise<T>;
  nowMs?: number;
}): Promise<{ value: T; cacheHit: boolean }> {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = Math.max(0, params.ttlSeconds) * 1000;
  const cacheKey = buildVersionedKey({
    namespace: params.namespace,
    rawKey: params.key,
  });

  const cached = cacheSingleton.get<T>(cacheKey, nowMs);
  if (cached !== null) {
    return {
      value: cached,
      cacheHit: true,
    };
  }

  const fresh = await params.producer();
  cacheSingleton.set(cacheKey, fresh, ttlMs, nowMs);
  return {
    value: fresh,
    cacheHit: false,
  };
}

export function resetResponseCacheForTests(): void {
  cacheSingleton.reset();
}

