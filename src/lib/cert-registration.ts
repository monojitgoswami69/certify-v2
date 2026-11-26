/**
 * Client-side helper for QR verification registration. Shared by the download
 * (GenerateButton) and email (EmailSendButton) batch flows.
 */
import { registerCertificates } from './api-client';
import type { IssuedEventDesign } from './event-design';
import type { CsvRow, EmailSettings } from '../types';

// Must stay at or below the server's MAX_BATCH in /api/certificates/register
const REGISTER_CHUNK_SIZE = 1000;
const REGISTER_ROSTER_BYTES = 4_000_000;

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
  onIssued: (ids: Map<number, string>, verificationOrigin: string | null) => void;
}): Promise<Map<number, string>> {
  const { records, existingIds, getDisplayName, getEmail, eventId, eventName, label, design, mailPreferences, onIssued } = params;
  const pending = records.filter(({ rowIndex }) => !existingIds.has(rowIndex));
  const merged = new Map(existingIds);
  const encoder = new TextEncoder();

  for (let index = 0; index < pending.length;) {
    // Submit the design with one recipient so artwork and a full roster
    // never share the largest request.
    const firstDesign = index === 0 ? design : undefined;
    const limit = Math.min(pending.length, index + (firstDesign ? 1 : REGISTER_CHUNK_SIZE));
    const items = [];
    let rosterBytes = 0;
    for (let next = index; next < limit; next++) {
      const { row } = pending[next];
      const item = { recipientName: getDisplayName(row) || 'Certificate Holder', recipientEmail: getEmail?.(row), rowData: row };
      const itemBytes = encoder.encode(JSON.stringify(item)).byteLength + 1;
      if (itemBytes > REGISTER_ROSTER_BYTES) throw new Error('A recipient record is too large to register. Shorten its fields and try again.');
      if (rosterBytes + itemBytes > REGISTER_ROSTER_BYTES) break;
      items.push(item);
      rosterBytes += itemBytes;
    }
    const { outcomes, verificationOrigin } = await registerCertificates(items, { eventId, eventName, label, design: firstDesign,
      mailPreferences: firstDesign ? mailPreferences : undefined });
    outcomes.forEach((outcome, offset) => {
      if (outcome.status !== 'conflict') merged.set(pending[index + offset].rowIndex, outcome.id);
    });
    onIssued(new Map(merged), verificationOrigin);
    if (outcomes.some(({ status }) => status === 'conflict')) {
      throw new Error('A recipient already has a certificate with different values. Open the event to review it.');
    }
    index += items.length;
  }

  return merged;
}
