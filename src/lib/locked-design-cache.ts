import type { IssuedEventDesign } from './event-design';

const MAX_CACHED_DESIGNS = 16;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
interface CacheEntry {
  design: IssuedEventDesign;
  bytes: number;
}
const globalForDesignCache = globalThis as unknown as {
  certifyLockedDesignCacheV2?: Map<string, CacheEntry>;
};
const lockedDesignCache =
  globalForDesignCache.certifyLockedDesignCacheV2 ?? new Map<string, CacheEntry>();
globalForDesignCache.certifyLockedDesignCacheV2 = lockedDesignCache;

export function isLockedDesignCacheEmpty(): boolean {
  return lockedDesignCache.size === 0;
}

export function getCachedLockedDesign(eventId: string): IssuedEventDesign | undefined {
  const cached = lockedDesignCache.get(eventId);
  if (!cached) return undefined;
  lockedDesignCache.delete(eventId);
  lockedDesignCache.set(eventId, cached);
  return cached.design;
}

export function setCachedLockedDesign(eventId: string, design: IssuedEventDesign): void {
  const bytes = 2 * (design.imageData.length + (design.previewImageData?.length ?? 0)
    + JSON.stringify(design.layoutConfig).length);
  if (bytes > MAX_CACHE_BYTES) return;
  lockedDesignCache.delete(eventId);
  let usedBytes = [...lockedDesignCache.values()].reduce((total, entry) => total + entry.bytes, 0);
  for (const [id, entry] of lockedDesignCache) {
    if (lockedDesignCache.size < MAX_CACHED_DESIGNS && usedBytes + bytes <= MAX_CACHE_BYTES) break;
    lockedDesignCache.delete(id);
    usedBytes -= entry.bytes;
  }
  lockedDesignCache.set(eventId, { design, bytes });
}
