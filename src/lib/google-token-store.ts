import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { and, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { googleCredentials, type GoogleCredentialRow } from '../db/schema';
import { env, googleClientId } from './env';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function encryptionKey(): Buffer {
  const hex = env.GMAIL_TOKEN_ENCRYPTION_KEY ?? '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Gmail credential encryption key is missing or invalid');
  return Buffer.from(hex, 'hex');
}

export function gmailConfigured(): boolean {
  return Boolean(googleClientId() && env.GOOGLE_CLIENT_SECRET && /^[0-9a-f]{64}$/i.test(env.GMAIL_TOKEN_ENCRYPTION_KEY ?? ''));
}

export function createGmailOAuthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: googleClientId(),
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  });
}

interface GmailOwner {
  userId: string;
  email: string;
}

type TokenKind = 'access' | 'refresh';

function associatedData(owner: GmailOwner, kind: TokenKind): Buffer {
  return Buffer.from(`${owner.userId}:${owner.email}:${kind}`);
}

function encryptToken(token: string, owner: GmailOwner, kind: TokenKind): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(associatedData(owner, kind));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptToken(value: string | null, owner: GmailOwner, kind: TokenKind): string | undefined {
  if (!value?.startsWith('v1.')) return undefined;
  const [, iv, tag, ciphertext] = value.split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAAD(associatedData(owner, kind));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

/** Called only after Google has verified this exact mailbox and granted gmail.send. */
export async function storeGoogleCredentials(
  owner: GmailOwner,
  credentials: { accessToken: string; refreshToken?: string | null; expiryDate?: number | null }
): Promise<void> {
  const values = {
    email: owner.email,
    accessToken: encryptToken(credentials.accessToken, owner, 'access'),
    expiryDate: credentials.expiryDate ?? null,
    scope: GMAIL_SEND_SCOPE,
    tokenType: 'Bearer',
    updatedAt: new Date(),
  };
  const refreshToken = credentials.refreshToken ? encryptToken(credentials.refreshToken, owner, 'refresh') : null;

  await db.insert(googleCredentials).values({ userId: owner.userId, ...values, refreshToken })
    .onConflictDoUpdate({
      target: googleCredentials.userId,
      set: {
        ...values,
        refreshToken: refreshToken ?? sqlMatchingRefreshToken(owner.email),
      },
    });
}

function sqlMatchingRefreshToken(email: string) {
  return sql`CASE
    WHEN ${googleCredentials.email} = ${email}
      AND ${googleCredentials.accessToken} LIKE 'v1.%'
      AND ${googleCredentials.refreshToken} LIKE 'v1.%'
    THEN ${googleCredentials.refreshToken}
  END`;
}

async function getConnection(owner: GmailOwner): Promise<(GoogleCredentialRow & { accessToken: string }) | null> {
  const [row] = await db.select().from(googleCredentials).where(and(
    eq(googleCredentials.userId, owner.userId),
    eq(googleCredentials.email, owner.email),
    eq(googleCredentials.scope, GMAIL_SEND_SCOPE)
  )).limit(1);
  return row?.accessToken?.startsWith('v1.') ? { ...row, accessToken: row.accessToken } : null;
}

export async function hasGoogleConnection(owner: GmailOwner): Promise<boolean> {
  if (!gmailConfigured()) return false;
  const row = await getConnection(owner);
  if (!row) return false;
  try {
    return Boolean(decryptToken(row.refreshToken, owner, 'refresh') ||
      (row.expiryDate && row.expiryDate > Date.now() && decryptToken(row.accessToken, owner, 'access')));
  } catch {
    return false;
  }
}

export async function clearGoogleCredentials(owner: GmailOwner): Promise<string | undefined> {
  const [row] = await db.delete(googleCredentials)
    .where(eq(googleCredentials.userId, owner.userId))
    .returning({ email: googleCredentials.email, refreshToken: googleCredentials.refreshToken, accessToken: googleCredentials.accessToken });
  if (row?.email !== owner.email) return undefined;
  try {
    return decryptToken(row.refreshToken, owner, 'refresh') ?? decryptToken(row.accessToken, owner, 'access');
  } catch {
    return undefined;
  }
}

function usableAccessToken(row: GoogleCredentialRow, owner: GmailOwner): string | undefined {
  if (row.expiryDate && row.expiryDate > Date.now() + 60_000) {
    return decryptToken(row.accessToken, owner, 'access');
  }
}

const refreshInFlight = new Map<string, Promise<string | null>>();

async function refreshAccessToken(owner: GmailOwner, row: GoogleCredentialRow & { accessToken: string }): Promise<string | null> {
  const refreshToken = decryptToken(row.refreshToken, owner, 'refresh');
  if (!refreshToken) return null;
  const client = createGmailOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });

  let token: string | null | undefined;
  try {
    ({ token } = await client.getAccessToken());
  } catch {
    return null;
  }
  if (!token) return null;

  // A refresh must not restore a grant that was disconnected or replaced while Google responded.
  const updated = await db.update(googleCredentials).set({
    accessToken: encryptToken(token, owner, 'access'),
    expiryDate: client.credentials.expiry_date ?? null,
    updatedAt: new Date(),
  }).where(and(
    eq(googleCredentials.userId, owner.userId),
    eq(googleCredentials.accessToken, row.accessToken)
  )).returning({ userId: googleCredentials.userId });
  if (updated.length) return token;
  const current = await getConnection(owner);
  return current ? usableAccessToken(current, owner) ?? null : null;
}

export async function getFreshAccessToken(owner: GmailOwner): Promise<string | null> {
  if (!gmailConfigured()) return null;
  const row = await getConnection(owner);
  if (!row) return null;
  try {
    const token = usableAccessToken(row, owner);
    if (token) return token;
    // A grant replacement gets a distinct key even if it belongs to the same account.
    const key = row.accessToken;
    let refresh = refreshInFlight.get(key);
    if (!refresh) {
      refresh = refreshAccessToken(owner, row).finally(() => refreshInFlight.delete(key));
      refreshInFlight.set(key, refresh);
    }
    return await refresh;
  } catch {
    return null;
  }
}
