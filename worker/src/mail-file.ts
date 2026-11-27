import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { SendMailOptions } from 'nodemailer';
import { buildMimeMessageStream, type MailAttachment } from '../../src/lib/gmail-mime.js';

const MAX_GMAIL_MESSAGE_BYTES = 35 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;

export class MailSizeError extends Error {}

export async function stageGmailMessage(
  options: Omit<SendMailOptions, 'attachments'> & { attachments: MailAttachment[] },
  signal?: AbortSignal
) {
  const directory = await mkdtemp(join(tmpdir(), 'wecertify-mail-'));
  const path = join(directory, 'message.eml');
  let file: FileHandle | undefined;
  let bytes = 0;
  try {
    file = await open(path, 'wx+', 0o600);
    // Unlink the directory before writing any certificate data. The descriptor
    // keeps the file available for this attempt, and the OS frees it on exit.
    await rm(directory, { recursive: true });
    const message = await buildMimeMessageStream({
      ...options,
      attachments: options.attachments.map(({ filename, content }) => ({
        filename,
        content: Readable.from((function* () {
          for (let offset = 0; offset < content.length; offset += STREAM_CHUNK_BYTES) {
            yield content.subarray(offset, offset + STREAM_CHUNK_BYTES);
          }
        })(), { objectMode: false, highWaterMark: STREAM_CHUNK_BYTES }),
      })),
    });
    for await (const chunk of message as AsyncIterable<Buffer>) {
      signal?.throwIfAborted();
      if (bytes + chunk.length > MAX_GMAIL_MESSAGE_BYTES) {
        throw new MailSizeError('Email exceeds Gmail message limit.');
      }
      for (let offset = 0; offset < chunk.length;) {
        // Positional writes leave the descriptor offset at the beginning.
        const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset, bytes);
        if (bytesWritten === 0) throw new Error('Unable to stage email.');
        bytes += bytesWritten;
        offset += bytesWritten;
      }
    }
    const handle = file;
    const streamOptions = { type: 'bytes' as const, autoClose: false };
    return {
      byteLength: bytes,
      open: () => handle.readableWebStream(streamOptions) as ReadableStream<Uint8Array<ArrayBuffer>>,
      dispose: () => handle.close(),
    };
  } catch (error) {
    await file?.close().catch(() => {});
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
