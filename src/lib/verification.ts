/**
 * Certificate verification primitives (server-only).
 *
 * The QR code embeds a random v4 UUID (122 bits of entropy), which is also the
 * row's primary key. Public lookups go through its SHA-256 `token_hash`
 * column. Treat the `certificates` table as sensitive: a DB dump does expose
 * live verification URLs.
 */
import { createHash, randomUUID } from 'crypto';

export function generateCertificateId(): string {
  return randomUUID();
}

export function hashToken(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

export function isValidCertificateId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
