import { describe, expect, it } from 'vitest';
import { MailSizeError, stageGmailMessage } from './mail-file.js';

const headers = { from: 'sender@example.test', to: 'recipient@example.test', subject: 'Certificate' };

describe('bounded worker mail staging', () => {
  it('streams MIME with its exact byte length and intact attachments', async () => {
    const attachment = Buffer.from('fixture certificate bytes');
    const staged = await stageGmailMessage({
      ...headers, text: 'Your certificate', attachments: [{ filename: 'certificate.pdf', content: attachment }],
    });
    try {
      const body = Buffer.from(await new Response(staged.open()).arrayBuffer());
      expect(body.byteLength).toBe(staged.byteLength);
      expect(body.toString()).toContain(attachment.toString('base64'));
    } finally {
      await staged.dispose();
    }
  });

  it('rejects an oversized MIME file before a request can start', async () => {
    await expect(stageGmailMessage({
      ...headers, attachments: [{ filename: 'oversized.pdf', content: Buffer.alloc(26 * 1024 ** 2) }],
    })).rejects.toBeInstanceOf(MailSizeError);
  });
});
