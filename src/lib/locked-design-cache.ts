import type { IssuedEventDesign } from './event-design';

const MAX_CACHED_DESIGNS = 16;
const globalForDesignCache = globalThis as unknown as {
  certifyLockedDesignCache?: Map<string, IssuedEventDesign>;
};
const lockedDesignCache =
  globalForDesignCache.certifyLockedDesignCache ?? new Map<string, IssuedEventDesign>();
globalForDesignCache.certifyLockedDesignCache = lockedDesignCache;

export function isLockedDesignCacheEmpty(): boolean {
  return lockedDesignCache.size === 0;
}

export function getCachedLockedDesign(eventId: string): IssuedEventDesign | undefined {
  const cached = lockedDesignCache.get(eventId);
  if (!cached) return undefined;
  lockedDesignCache.delete(eventId);
  lockedDesignCache.set(eventId, cached);
  return cached;
}

export function setCachedLockedDesign(eventId: string, design: IssuedEventDesign): void {
  if (lockedDesignCache.size >= MAX_CACHED_DESIGNS) {
    const oldest = lockedDesignCache.keys().next().value;
    if (oldest !== undefined) lockedDesignCache.delete(oldest);
  }
  lockedDesignCache.set(eventId, design);
}
