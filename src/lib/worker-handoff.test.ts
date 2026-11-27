import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptHandoffSecret,
  encryptHandoffSecret,
  generatePkcePair,
  isValidHandoffKey,
} from './worker-handoff';

const KEY = 'a'.repeat(64);

describe('worker-handoff PKCE and AES-256-GCM envelope', () => {
  it('generates valid S256 PKCE challenges and unique states', () => {
    const first = generatePkcePair();
    const second = generatePkcePair();
    expect(first.state).not.toBe(second.state);
    expect(first.stateHash).toHaveLength(64);
    const expectedChallenge = createHash('sha256').update(first.codeVerifier, 'ascii').digest('base64url');
    expect(first.codeChallenge).toBe(expectedChallenge);
  });

  it('encrypts and binds secrets strictly to handoffId, userId, batchId, and kind', () => {
    expect(isValidHandoffKey(KEY)).toBe(true);
    expect(isValidHandoffKey('short')).toBe(false);

    const ctx = { handoffId: 'h1', userId: 'u1', batchId: 'b1', kind: 'code' as const };
    const cipher = encryptHandoffSecret('4/0SecretOAuthCode', ctx, KEY);
    expect(cipher).not.toContain('4/0SecretOAuthCode');
    expect(decryptHandoffSecret(cipher, ctx, KEY)).toBe('4/0SecretOAuthCode');

    expect(() => decryptHandoffSecret(cipher, { ...ctx, userId: 'u2' }, KEY)).toThrow();
    expect(() => decryptHandoffSecret(cipher, { ...ctx, batchId: 'b2' }, KEY)).toThrow();
    expect(() => decryptHandoffSecret(cipher, { ...ctx, kind: 'verifier' }, KEY)).toThrow();
    expect(() => decryptHandoffSecret(cipher, ctx, 'b'.repeat(64))).toThrow();
  });
});
