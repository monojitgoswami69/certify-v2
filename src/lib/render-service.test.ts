import { expect, it, vi } from 'vitest';
import { PooledCertificateRenderer } from './render-service';
import type { CertificateWorkerPool, WorkerTask } from './worker-pool';

it('shares the final in-flight chunk across simultaneous mail renders', async () => {
  const tasks: WorkerTask[] = Array.from({ length: 4 }, (_, index) => ({
    id: index, rowIndex: index, row: { Name: String(index) }, filename: String(index),
  }));
  const processChunk = vi.fn<CertificateWorkerPool['processChunk']>(async (chunk, onResult) => {
    await Promise.resolve();
    for (const [index, task] of chunk.entries()) {
      onResult?.({ ...task, blobs: { pdf: new Blob([task.filename]) } }, index + 1, chunk.length);
    }
  });
  const renderer = new PooledCertificateRenderer({ processChunk }, tasks, tasks.length);
  const results = await Promise.all(tasks.map((task) => renderer.render(task)));

  expect(processChunk).toHaveBeenCalledTimes(1);
  expect(await Promise.all(results.map((result) => result.blobs?.pdf?.text()))).toEqual(['0', '1', '2', '3']);
});
