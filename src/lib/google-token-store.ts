import { OAuth2Client } from 'google-auth-library';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const REDIRECT_URI = 'postmessage';

export interface StoredGoogleCredentials {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  token_type?: string | null;
  email?: string;
}

const store = new Map<string, StoredGoogleCredentials>();

export function storeGoogleCredentials(username: string, creds: StoredGoogleCredentials): void {
  const prev = store.get(username);
  // Google only returns a refresh_token on first consent. Preserve any
  // previously stored refresh_token if the new exchange omitted one.
  store.set(username, {
    ...prev,
    ...creds,
    refresh_token: creds.refresh_token ?? prev?.refresh_token ?? null,
  });
}

export function getStoredGoogleCredentials(username: string): StoredGoogleCredentials | null {
  return store.get(username) ?? null;
}

export function clearGoogleCredentials(username: string): void {
  store.delete(username);
}

export function getStoredGoogleEmail(username: string): string | null {
  return store.get(username)?.email ?? null;
}

export function buildGoogleOAuthClient(username: string): OAuth2Client | null {
  const creds = store.get(username);
  if (!creds || (!creds.access_token && !creds.refresh_token)) return null;

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
