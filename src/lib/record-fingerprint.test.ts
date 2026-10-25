import { describe, it, expect } from 'vitest';
import {
  computeIdentityFingerprint,
  computeLegacyEmailFingerprint,
  pickEmailFromRowData,
} from './record-fingerprint';

const USER = '00000000-0000-4000-8000-000000000001';

describe('computeIdentityFingerprint', () => {
  it('includes the name when an email exists, so a rename is a different person', () => {
    const johnny = computeIdentityFingerprint(USER, 'Hackathon 2026', 'Johnny Smith', 'x@y.com');
    const john = computeIdentityFingerprint(USER, 'Hackathon 2026', 'John Smith', 'x@y.com');
    expect(johnny).not.toEqual(john);
  });

  it('is deterministic and independent of batch composition or row order', () => {
    const a = computeIdentityFingerprint(USER, 'Hackathon 2026', 'Johnny Smith', 'x@y.com');
    const b = computeIdentityFingerprint(USER, 'Hackathon 2026', 'Johnny Smith', 'x@y.com');
    expect(a).toEqual(b);
  });

  it('normalizes case and outer whitespace so identity is stable across roster edits', () => {
    const a = computeIdentityFingerprint(USER, '  Hackathon 2026 ', ' Johnny Smith ', 'X@Y.com');
    const b = computeIdentityFingerprint(USER, 'hackathon 2026', 'johnny smith', 'x@y.com');
    expect(a).toEqual(b);
  });

  it('is scoped per account, event, email, and name', () => {
    const base = computeIdentityFingerprint(USER, 'E', 'A B', 'a@b.c');
    expect(computeIdentityFingerprint(USER, 'Other', 'A B', 'a@b.c')).not.toEqual(base);
    expect(computeIdentityFingerprint(USER, 'E', 'A B', 'z@b.c')).not.toEqual(base);
    expect(computeIdentityFingerprint('00000000-0000-4000-8000-000000000002', 'E', 'A B', 'a@b.c')).not.toEqual(base);
  });

  it('keys email-less rows by name only', () => {
    const noEmail = computeIdentityFingerprint(USER, 'E', 'A B', null);
    const withEmail = computeIdentityFingerprint(USER, 'E', 'A B', 'a@b.c');
    expect(noEmail).not.toEqual(withEmail);

    const emptyStringEmail = computeIdentityFingerprint(USER, 'E', 'A B', '');
    expect(emptyStringEmail).toEqual(noEmail);
  });
});

describe('computeLegacyEmailFingerprint', () => {
  it('matches the legacy email-only scheme (name excluded)', () => {
    const legacy = computeLegacyEmailFingerprint(USER, 'E', 'a@b.c');
    expect(legacy).toMatch(/^[0-9a-f]{64}$/);
    expect(computeLegacyEmailFingerprint(USER, 'E', 'A@B.C')).toEqual(legacy);
    expect(computeLegacyEmailFingerprint(USER, 'E', '')).toBeNull();
  });
});

describe('pickEmailFromRowData', () => {
  it('prefers exact email column names, never positional order', () => {
    const guardianFirst = {
      'Guardian Email': 'parent@example.com',
      Email: 'student@example.com',
    };
    expect(pickEmailFromRowData(guardianFirst)).toBe('student@example.com');
  });

  it('normalizes column-name variants (spaces, case, underscores)', () => {
    expect(pickEmailFromRowData({ recipient_email: 'a@b.c' })).toBe('a@b.c');
    expect(pickEmailFromRowData({ 'EMAIL ADDRESS': 'a@b.c' })).toBe('a@b.c');
    expect(pickEmailFromRowData({ Mail: 'a@b.c' })).toBe('a@b.c');
  });

  it('returns null when no explicitly email-named column exists', () => {
    expect(pickEmailFromRowData({ Name: 'x', Contact: 'a@b.c' })).toBeNull();
    expect(pickEmailFromRowData(null)).toBeNull();
    expect(pickEmailFromRowData({})).toBeNull();
  });
});
