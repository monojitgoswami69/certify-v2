import { OAuth2Client } from 'google-auth-library';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { googleCredentials } from '../db/schema';
import { env, googleClientId } from './env';

const GOOGLE_CLIENT_ID = googleClientId();
const GOOGLE_CLIENT_SECRET = env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = 'postmessage';

export interface StoredGoogleCredentials {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  token_type?: string | null;
  email?: string;
}

/**
 * Gmail OAuth credentials, persisted in Postgres (survive restarts, shared
 * across instances) with an in-memory read-through cache so the hot email
 * path does not query the database per message.
 */
const cache = new Map<string, StoredGoogleCredentials>();
// One refresh at a time per account: a 10-worker email batch must not trigger
// ten parallel Google token refreshes with the same refresh token.
const refreshInFlight = new Map<string, Promise<string | null>>();

function mergeCreds(prev: StoredGoogleCredentials | undefined, creds: StoredGoogleCredentials): StoredGoogleCredentials {
  // Google only returns a refresh_token on first consent. Preserve any
  // previously stored refresh_token if the new exchange omitted one.
  return {
    ...prev,
    ...creds,
    refresh_token: creds.refresh_token ?? prev?.refresh_token ?? null,
  };
}

export async function storeGoogleCredentials(
  userId: string,
  creds: StoredGoogleCredentials
): Promise<void> {
  const merged = mergeCreds(cache.get(userId), creds);
  cache.set(userId, merged);
  try {
    await db
      .insert(googleCredentials)
      .values({
        userId,
        accessToken: merged.access_token ?? null,
        refreshToken: merged.refresh_token ?? null,
        expiryDate: merged.expiry_date ?? null,
        scope: merged.scope ?? null,
        tokenType: merged.token_type ?? null,
        email: merged.email ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: googleCredentials.userId,
        set: {
          accessToken: merged.access_token ?? null,
          refreshToken: merged.refresh_token ?? null,
          expiryDate: merged.expiry_date ?? null,
          scope: merged.scope ?? null,
          tokenType: merged.token_type ?? null,
          email: merged.email ?? null,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    // Cache still holds the credentials, so sending keeps working this boot.
    console.warn('[Google token store] persist failed:', err);
  }
}

export async function getStoredGoogleCredentials(
  userId: string
): Promise<StoredGoogleCredentials | null> {
  const cached = cache.get(userId);
  if (cached) return cached;
  try {
    const [row] = await db
      .select()
      .from(googleCredentials)
      .where(eq(googleCredentials.userId, userId))
      .limit(1);
    if (!row || (!row.accessToken && !row.refreshToken)) return null;
    const creds: StoredGoogleCredentials = {
      access_token: row.accessToken,
      refresh_token: row.refreshToken,
      expiry_date: row.expiryDate,
      scope: row.scope,
      token_type: row.tokenType,
      email: row.email ?? undefined,
    };
    cache.set(userId, creds);
    return creds;
  } catch (err) {
    console.warn('[Google token store] load failed:', err);
    return null;
  }
}

export async function clearGoogleCredentials(userId: string): Promise<void> {
  cache.delete(userId);
  refreshInFlight.delete(userId);
  try {
    await db.delete(googleCredentials).where(eq(googleCredentials.userId, userId));
  } catch (err) {
    console.warn('[Google token store] delete failed:', err);
  }
}

export async function getStoredGoogleEmail(userId: string): Promise<string | null> {
  const creds = await getStoredGoogleCredentials(userId);
  return creds?.email ?? null;
}

function buildClient(creds: StoredGoogleCredentials): OAuth2Client {
  const client = new OAuth2Client({
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
  });
  client.setCredentials({
    access_token: creds.access_token ?? undefined,
    refresh_token: creds.refresh_token ?? undefined,
    expiry_date: creds.expiry_date ?? undefined,
    token_type: creds.token_type ?? undefined,
  });
  return client;
}

/**
 * Returns a valid Gmail access token for the account, refreshing (and
 * persisting) it when expired. Refreshes are single-flight per account.
 * Returns null when no credentials are connected.
 */
export async function getFreshAccessToken(userId: string): Promise<string | null> {
  const creds = await getStoredGoogleCredentials(userId);
  if (!creds || (!creds.access_token && !creds.refresh_token)) return null;

  if (creds.access_token && creds.expiry_date && creds.expiry_date - 60_000 > Date.now()) {
    return creds.access_token;
  }

  let refresh = refreshInFlight.get(userId);
  if (!refresh) {
    refresh = (async () => {
      const client = buildClient(creds);
      const { token } = await client.getAccessToken();
      if (!token) return null;
      const expiry = client.credentials.expiry_date ?? null;
      cache.set(userId, { ...creds, access_token: token, expiry_date: expiry });
      try {
        await db
          .update(googleCredentials)
          .set({ accessToken: token, expiryDate: expiry, updatedAt: new Date() })
          .where(eq(googleCredentials.userId, userId));
      } catch (err) {
        console.warn('[Google token store] refreshed-token persist failed:', err);
      }
      return token;
    })().finally(() => refreshInFlight.delete(userId));
    refreshInFlight.set(userId, refresh);
  }

  try {
    return await refresh;
  } catch (err) {
    console.warn('[Google token store] refresh failed:', err);
    return null;
  }
}

/** Kept for callers that need the raw OAuth2 client (userinfo lookups etc.). */
export async function buildGoogleOAuthClient(userId: string): Promise<OAuth2Client | null> {
  const creds = await getStoredGoogleCredentials(userId);
  if (!creds || (!creds.access_token && !creds.refresh_token)) return null;
  return buildClient(creds);
}
