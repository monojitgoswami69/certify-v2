/**
 * requestAnimationFrame Coalesced Scheduler
 * 
 * Collapses high-frequency worker callbacks into a single React state update
 * per animation frame (max 60 updates/sec).
 */

export function createRafScheduler<T>(update: (value: T) => void): {
  schedule: (value: T) => void;
  flush: () => void;
  cancel: () => void;
} {
  let queued: { value: T } | null = null;
  let handle: number | null = null;

  const fire = () => {
    handle = null;
    if (queued) {
      const v = queued.value;
      queued = null;
      update(v);
    }
  };

  return {
    schedule(value: T) {
      queued = { value };
      if (handle === null && typeof requestAnimationFrame !== 'undefined') {
        handle = requestAnimationFrame(fire);
      } else if (typeof requestAnimationFrame === 'undefined') {
        fire();
      }
    },
    flush() {
      if (handle !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(handle);
        handle = null;
      }
      if (queued) {
        const v = queued.value;
        queued = null;
        update(v);
      }
    },
    cancel() {
      if (handle !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(handle);
        handle = null;
      }
      queued = null;
    },
  };
}
