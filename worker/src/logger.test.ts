import { describe, expect, it } from 'vitest';
import { createWorkerLogger } from './logger.js';

describe('worker logger PII and token redaction', () => {
  it('excludes sensitive keys, emails, and bearer credentials from structured logs', () => {
    const lines: string[] = [];
    const logger = createWorkerLogger('worker-test', (_level, line) => lines.push(line));

    logger.info('Processed recipient bob@example.com with Bearer ya29.secretToken', {
      batchId: 'b-1',
      itemId: 'i-1',
      accessToken: 'ya29.supersecret',
      refreshToken: '1//secret',
      recipientEmail: 'alice@example.com',
      code: '4/0authcode',
      rawResponse: '{"id":"leak"}',
      detail: 'Sent notification for carol@example.org',
      durationMs: 42,
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.batchId).toBe('b-1');
    expect(parsed.durationMs).toBe(42);
    expect(parsed.accessToken).toBeUndefined();
    expect(parsed.refreshToken).toBeUndefined();
    expect(parsed.recipientEmail).toBeUndefined();
    expect(parsed.code).toBeUndefined();
    expect(parsed.rawResponse).toBeUndefined();
    expect(lines[0]).not.toContain('ya29.');
    expect(lines[0]).not.toContain('alice@example.com');
    expect(lines[0]).not.toContain('bob@example.com');
    expect(lines[0]).not.toContain('carol@example.org');
  });
});
