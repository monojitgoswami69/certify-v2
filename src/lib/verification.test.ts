import { describe, it, expect } from 'vitest';
import { generateCertificateId, hashToken, isValidCertificateId } from './verification';

describe('verification primitives', () => {
  it('generates valid v4 UUIDs', () => {
    for (let i = 0; i < 50; i++) {
      const id = generateCertificateId();
      expect(isValidCertificateId(id)).toBe(true);
      // v4 marker nibble
      expect(id[14]).toBe('4');
    }
  });

  it('hashToken is a stable sha-256 hex digest', () => {
    const id = generateCertificateId();
    expect(hashToken(id)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(id)).toEqual(hashToken(id));
    expect(hashToken(id)).not.toEqual(hashToken(generateCertificateId()));
  });

  it('rejects malformed ids', () => {
    expect(isValidCertificateId('')).toBe(false);
    expect(isValidCertificateId('not-a-uuid')).toBe(false);
    expect(isValidCertificateId('123e4567-e89b-12d3-a456-42661417400')).toBe(false); // too short
    expect(
      isValidCertificateId('123e4567e89b12d3a456426614174000-123e4567-e89b-12d3-a456-426614174000'.slice(0, 36))
    ).toBe(false);
    expect(isValidCertificateId('123E4567-E89B-12D3-A456-426614174000')).toBe(true); // case-insensitive
    expect(isValidCertificateId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
  });
});
