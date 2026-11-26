export type MailAttachmentSlot = 'png' | 'pdf' | 'jpg';

export interface StagedMailSlice {
  slot: MailAttachmentSlot;
  bytes: number;
}

interface StagedMailHeader {
  v: 1;
  slots: StagedMailSlice[];
}

export const INLINE_MAIL_BODY_THRESHOLD_BYTES = 3_500_000;
export const MAX_STAGED_MAIL_BYTES = 25 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;
const VALID_SLOTS = new Set<MailAttachmentSlot>(['png', 'pdf', 'jpg']);

/**
 * Packs rendered certificate attachments into a single compact binary envelope
 * (`[4B uint32BE headerLen][UTF-8 JSON header][raw blob bytes...]`) so oversized
 * (>3.5 MB) emails upload in one R2 PUT without base64 inflation.
 */
export async function packMailAttachments(
  items: Array<{ slot: MailAttachmentSlot; blob: Blob }>
): Promise<Blob> {
  const nonEmpty = items.filter((item) => item.blob.size > 0);
  if (nonEmpty.length === 0) {
    throw new Error('At least one attachment is required.');
  }

  const header: StagedMailHeader = {
    v: 1,
    slots: nonEmpty.map((item) => ({ slot: item.slot, bytes: item.blob.size })),
  };
  const headerBytes = new TextEncoder().encode(JSON.stringify(header));
  if (headerBytes.byteLength > MAX_HEADER_BYTES) {
    throw new Error('Staged attachment metadata is too large.');
  }

  const prefix = new ArrayBuffer(4);
  new DataView(prefix).setUint32(0, headerBytes.byteLength, false);

  const blob = new Blob([prefix, headerBytes, ...nonEmpty.map((item) => item.blob)], {
    type: 'application/octet-stream',
  });
  if (blob.size > MAX_STAGED_MAIL_BYTES) {
    throw new Error('Email attachments exceed the 24 MB Gmail message limit');
  }
  return blob;
}

/**
 * Unpacks and strictly bounds-checks an envelope produced by `packMailAttachments`.
 */
export function unpackMailAttachments(
  buffer: Uint8Array
): Array<{ slot: MailAttachmentSlot; data: Buffer }> {
  if (buffer.byteLength < 8 || buffer.byteLength > MAX_STAGED_MAIL_BYTES) {
    throw new SyntaxError('Invalid staged mail payload size');
  }

  const headerLen = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0, false);
  if (headerLen === 0 || headerLen > MAX_HEADER_BYTES || 4 + headerLen >= buffer.byteLength) {
    throw new SyntaxError('Invalid staged mail header length');
  }

  let parsed: Partial<StagedMailHeader>;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(4, 4 + headerLen)));
  } catch {
    throw new SyntaxError('Invalid staged mail header JSON');
  }

  if (parsed?.v !== 1 || !Array.isArray(parsed.slots) || parsed.slots.length === 0 || parsed.slots.length > 3) {
    throw new SyntaxError('Invalid staged mail slots');
  }

  let offset = 4 + headerLen;
  const result: Array<{ slot: MailAttachmentSlot; data: Buffer }> = [];
  for (const entry of parsed.slots) {
    if (
      !entry ||
      !VALID_SLOTS.has(entry.slot) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      offset + entry.bytes > buffer.byteLength
    ) {
      throw new SyntaxError('Invalid staged attachment slice');
    }
    result.push({
      slot: entry.slot,
      data: Buffer.from(buffer.buffer, buffer.byteOffset + offset, entry.bytes),
    });
    offset += entry.bytes;
  }

  if (offset !== buffer.byteLength) {
    throw new SyntaxError('Trailing bytes in staged mail payload');
  }

  return result;
}
