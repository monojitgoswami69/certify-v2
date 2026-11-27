import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type HandoffSecretKind = 'verifier' | 'code';

export interface HandoffContext {
  handoffId: string;
  userId: string;
  batchId: string;
  kind: HandoffSecretKind;
}

function parseHandoffKey(keyHex: string | undefined): Buffer {
  if (!keyHex || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error('WORKER_HANDOFF_KEY must be a 64-character hex string');
  }
  return Buffer.from(keyHex, 'hex');
}

export function isValidHandoffKey(keyHex: string | undefined): boolean {
  return Boolean(keyHex && /^[0-9a-f]{64}$/i.test(keyHex));
}

function aadFor(ctx: HandoffContext): Buffer {
  return Buffer.from(`wecertify:handoff:v1:${ctx.handoffId}:${ctx.userId}:${ctx.batchId}:${ctx.kind}`, 'utf8');
}

export function generatePkcePair(): {
  state: string;
  stateHash: string;
  codeVerifier: string;
  codeChallenge: string;
} {
  const state = randomBytes(32).toString('base64url');
  const stateHash = createHash('sha256').update(state, 'utf8').digest('hex');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');
  return { state, stateHash, codeVerifier, codeChallenge };
}

export function sha256HexUtf8(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function encryptHandoffSecret(plaintext: string, ctx: HandoffContext, keyHex: string | undefined): string {
  const key = parseHandoffKey(keyHex);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadFor(ctx));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptHandoffSecret(envelope: string, ctx: HandoffContext, keyHex: string | undefined): string {
  if (!envelope || !envelope.startsWith('v1.')) {
    throw new Error('Malformed encrypted handoff payload');
  }
  const parts = envelope.split('.');
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted handoff payload');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = parseHandoffKey(keyHex);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAAD(aadFor(ctx));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}
