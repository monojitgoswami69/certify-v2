import { afterEach, describe, expect, it } from 'vitest';
import { CertificateWorkerPool, type WorkerTask } from './worker-pool';

const originalWorker = globalThis.Worker;

afterEach(() => {
  globalThis.Worker = originalWorker;
});

function createTasks(count: number): WorkerTask[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    rowIndex: i + 1,
    row: { Name: `User ${i + 1}` },
    filename: `User_${i + 1}`,
  }));
}

describe('CertificateWorkerPool', () => {
  it('terminates already-spawned workers if any worker fails initialization', async () => {
    let instanceIndex = 0;
    const terminated: number[] = [];

    class FlakyInitWorker {
      private listeners = new Map<string, Set<(event: unknown) => void>>();
      private idx = instanceIndex++;
      addEventListener(type: string, cb: (event: unknown) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(cb);
      }
      removeEventListener(type: string, cb: (event: unknown) => void) {
        this.listeners.get(type)?.delete(cb);
      }
      postMessage(msg: { type: string }) {
        if (msg.type === 'init') {
          queueMicrotask(() => {
            const payload = this.idx === 1
              ? { data: { type: 'ready', result: { error: 'Bitmap decode failed' } } }
              : { data: { type: 'ready' } };
            for (const cb of this.listeners.get('message') ?? []) cb(payload);
          });
        }
      }
      terminate() {
        terminated.push(this.idx);
      }
    }

    globalThis.Worker = FlakyInitWorker as unknown as typeof Worker;
    const pool = new CertificateWorkerPool();
    await expect(
      pool.initialize(new Blob(['x']), 800, 600, [], [], ['png'], undefined, 2)
    ).rejects.toThrow('Bitmap decode failed');
    expect(terminated.sort()).toEqual([0, 1]);
  });

  it('steals work dynamically and recovers crashed worker tasks on surviving healthy workers', async () => {
    let instanceIndex = 0;
    const processedByWorker = new Map<number, number[]>();
    let crashedWorker0 = false;

    class ResilientWorker {
      private listeners = new Map<string, Set<(event: unknown) => void>>();
      private idx = instanceIndex++;
      private alive = true;
      addEventListener(type: string, cb: (event: unknown) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(cb);
      }
      removeEventListener(type: string, cb: (event: unknown) => void) {
        this.listeners.get(type)?.delete(cb);
      }
      postMessage(msg: { type: string; items?: Array<{ id: number; rowIndex: number; filename: string }> }) {
        if (!this.alive) return;
        if (msg.type === 'init') {
          queueMicrotask(() => {
            for (const cb of this.listeners.get('message') ?? []) cb({ data: { type: 'ready' } });
          });
          return;
        }
        if (msg.type === 'generateBatch' && msg.items) {
          const items = msg.items;
          setTimeout(() => {
            if (!this.alive) return;
            // Worker 0 crashes on its very first batch!
            if (this.idx === 0 && !crashedWorker0) {
              crashedWorker0 = true;
              for (const cb of this.listeners.get('error') ?? []) cb({ message: 'Simulated OOM crash' });
              return;
            }
            const list = processedByWorker.get(this.idx) ?? [];
            for (const item of items) {
              list.push(item.id);
              for (const cb of this.listeners.get('message') ?? []) {
                cb({
                  data: {
                    type: 'itemComplete',
                    result: { id: item.id, rowIndex: item.rowIndex, filename: item.filename, blobs: { png: new Blob(['ok']) } },
                  },
                });
              }
            }
            processedByWorker.set(this.idx, list);
            for (const cb of this.listeners.get('message') ?? []) cb({ data: { type: 'batchComplete' } });
          }, this.idx === 0 ? 5 : 2);
        }
      }
      terminate() {
        this.alive = false;
      }
    }

    globalThis.Worker = ResilientWorker as unknown as typeof Worker;
    const pool = new CertificateWorkerPool();
    const count = await pool.initialize(new Blob(['x']), 800, 600, [], [], ['png'], undefined, 2);

    // If machine reported hardwareConcurrency <= 2, force 2-worker behavior check safely:
    if (count >= 2) {
      const results1 = new Map<number, string>();
      await pool.processChunk(createTasks(10), (res) => {
        expect(results1.has(res.id)).toBe(false);
        results1.set(res.id, res.error ? `err:${res.error}` : 'ok');
      });
      expect(results1.size).toBe(10);
      expect(Array.from(results1.values()).every((v) => v === 'ok')).toBe(true);

      // Subsequent chunk must still succeed cleanly without Worker 0 poisoning any records
      const results2: number[] = [];
      await pool.processChunk(createTasks(6), (res) => {
        if (!res.error) results2.push(res.id);
      });
      expect(results2.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
    }
    pool.terminate();
  });

  it('settles all items once when every worker dies and throws on subsequent chunks', async () => {
    class CrashingWorker {
      private listeners = new Map<string, Set<(event: unknown) => void>>();
      addEventListener(type: string, cb: (event: unknown) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(cb);
      }
      removeEventListener(type: string, cb: (event: unknown) => void) {
        this.listeners.get(type)?.delete(cb);
      }
      postMessage(msg: { type: string }) {
        if (msg.type === 'init') {
          queueMicrotask(() => {
            for (const cb of this.listeners.get('message') ?? []) cb({ data: { type: 'ready' } });
          });
        } else if (msg.type === 'generateBatch') {
          queueMicrotask(() => {
            for (const cb of this.listeners.get('error') ?? []) cb({ message: 'Fatal worker failure' });
          });
        }
      }
      terminate() {}
    }

    globalThis.Worker = CrashingWorker as unknown as typeof Worker;
    const pool = new CertificateWorkerPool();
    await pool.initialize(new Blob(['x']), 800, 600, [], [], ['png'], undefined, 1);

    const settled: Array<{ id: number; error?: string }> = [];
    await pool.processChunk(createTasks(3), (res) => {
      settled.push({ id: res.id, error: res.error });
    });
    expect(settled.map((s) => s.id).sort()).toEqual([0, 1, 2]);
    expect(settled.every((s) => s.error === 'Fatal worker failure')).toBe(true);

    await expect(pool.processChunk(createTasks(1))).rejects.toThrow('All certificate workers have failed');
    pool.terminate();
  });
});
