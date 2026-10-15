/**
 * Client-side helper for QR verification registration. Shared by the download
 * (GenerateButton) and email (EmailSendButton) batch flows.
 */
import { registerCertificates } from './api-client';
import type { CsvRow } from '../types';

export const VERIFY_APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');

// Must stay at or below the server's MAX_BATCH in /api/certificates/register
const REGISTER_CHUNK_SIZE = 1000;

export function buildVerifyUrlFor(id: string): string {
  return `${VERIFY_APP_URL.replace(/\/+$/, '')}/verify/${id}`;
}

/**
 * Ensures every record has a registered certificate id. Rows already present
 * in `existingIds` (e.g. on a "Retry Failed" pass) are NOT re-registered, so
 * retries never create duplicate database rows. Throws on failure — callers
 * must abort the batch rather than render QR codes that can't verify.
 */
export async function ensureCertificateIds(params: {
  records: Array<{ rowIndex: number; row: CsvRow }>;
  existingIds: Map<number, string>;
  getDisplayName: (row: CsvRow) => string;
  getEmail?: (row: CsvRow) => string;
  templateName: string;
  eventName?: string;
  isStatic?: boolean;
  activeFields?: string[];
}): Promise<Map<number, string>> {
  const {
    records,
    existingIds,
    getDisplayName,
    getEmail,
    templateName,
    eventName,
    isStatic,
    activeFields,
  } = params;

  const pending = records.filter(({ rowIndex }) => !existingIds.has(rowIndex));
  if (pending.length === 0) return existingIds;

  const activeFieldSet =
    activeFields && activeFields.length > 0 ? new Set(activeFields) : null;

  const items = pending.map(({ row }) => {
      // Preserve full CSV row data so all recipient columns remain intact in database
      const rowData =
        activeFieldSet && activeFieldSet.size > 0
          ? {
              ...row,
              ...Object.fromEntries(
                Object.entries(row).filter(([key]) => activeFieldSet.has(key))
              ),
            }
          : row;

      return {
        recipientName: getDisplayName(row) || 'Certificate Holder',
        recipientEmail: getEmail ? getEmail(row) : undefined,
        rowData,
        templateName,
        eventName,
        isStatic,
      };
    });

  const ids: string[] = [];
  for (let i = 0; i < items.length; i += REGISTER_CHUNK_SIZE) {
    const chunk = items.slice(i, i + REGISTER_CHUNK_SIZE);
    const chunkIds = await registerCertificates(chunk, eventName, isStatic);
    if (chunkIds.length !== chunk.length) {
      throw new Error('Registration response did not match the submitted records. Please retry.');
    }
    ids.push(...chunkIds);
  }

  const merged = new Map(existingIds);
  pending.forEach(({ rowIndex }, i) => {
    merged.set(rowIndex, ids[i]);
  });
  return merged;
}
