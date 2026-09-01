/**
 * Certificate verification primitives (server-only).
 *
 * The QR code embeds the raw UUID, but the database only ever stores its
 * SHA-256 hash, so a full DB dump does not yield a list of live verification
 * URLs (an attacker would need to brute-force 122-bit UUIDs).
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

export function buildVerifyUrl(id: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/verify/${id}`;
}
