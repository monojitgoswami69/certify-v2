/**
 * Client-side helper for QR verification registration. Shared by the download
 * (GenerateButton) and email (EmailSendButton) batch flows.
 */
import { registerCertificates } from './api-client';
import type { IssuedEventDesign } from './event-design';
import type { CsvRow, EmailSettings } from '../types';

export function getVerifyBaseUrl(): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim()
    || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
  return origin.replace(/\/+$/, '');
}

export function buildVerifyUrlFor(id: string): string {
  return `${getVerifyBaseUrl()}/verify/${id}`;
}

export const VERIFY_APP_URL = getVerifyBaseUrl();

// Must stay at or below the server's MAX_BATCH in /api/certificates/register
const REGISTER_CHUNK_SIZE = 1000;

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
  eventId: string;
  eventName: string;
  label: string;
  design?: IssuedEventDesign;
  mailPreferences?: EmailSettings;
  onIssued: (ids: Map<number, string>) => void;
}): Promise<Map<number, string>> {
  const { records, existingIds, getDisplayName, getEmail, eventId, eventName, label, design, mailPreferences, onIssued } = params;
  const pending = records.filter(({ rowIndex }) => !existingIds.has(rowIndex));
  const merged = new Map(existingIds);

  for (let index = 0; index < pending.length;) {
    // Submit the design with one recipient so artwork and a full roster
    // never share the largest request.
    const firstDesign = index === 0 ? design : undefined;
    const chunk = pending.slice(index, index + (firstDesign ? 1 : REGISTER_CHUNK_SIZE));
    const items = chunk.map(({ row }) => ({
      recipientName: getDisplayName(row) || 'Certificate Holder',
      recipientEmail: getEmail?.(row),
      rowData: row,
    }));
    const outcomes = await registerCertificates(items, { eventId, eventName, label, design: firstDesign,
      mailPreferences: firstDesign ? mailPreferences : undefined });
    outcomes.forEach((outcome, offset) => {
      if (outcome.status !== 'conflict') merged.set(chunk[offset].rowIndex, outcome.id);
    });
    onIssued(new Map(merged));
    if (outcomes.some(({ status }) => status === 'conflict')) {
      throw new Error('A recipient already has a certificate with different values. Open the event to review it.');
    }
    index += chunk.length;
  }

  return merged;
}
