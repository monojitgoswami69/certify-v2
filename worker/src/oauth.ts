import type { WorkerEnv } from './env.js';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const EXPIRY_SAFETY_BUFFER_MS = 15_000;

export class InMemoryBatchToken {
  private accessToken: string | null;
  public readonly expiresAtMs: number;

  constructor(accessToken: string, expiresAtMs: number) {
    this.accessToken = accessToken;
    this.expiresAtMs = expiresAtMs;
  }

  isValid(nowMs = Date.now()): boolean {
    return this.accessToken !== null && nowMs < this.expiresAtMs - EXPIRY_SAFETY_BUFFER_MS;
  }

  getAccessToken(nowMs = Date.now()): string | null {
    if (!this.isValid(nowMs)) {
      this.clear();
      return null;
    }
    return this.accessToken;
  }

  clear(): void {
    this.accessToken = null;
  }
}

export type OAuthExchangeOutcome =
  | { ok: true; token: InMemoryBatchToken; expiresAt: Date }
  | { ok: false; code: string; userMessage: string; retryable: boolean };

export async function exchangeBatchOAuthCode(params: {
  env: Pick<
    WorkerEnv,
    'resolvedGoogleClientId' | 'GOOGLE_CLIENT_SECRET' | 'WORKER_OAUTH_TOKEN_URL' | 'WORKER_OAUTH_USERINFO_URL'
  >;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  expectedSenderEmail: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthExchangeOutcome> {
  const fetchFn = params.fetchImpl ?? fetch;

  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: params.env.resolvedGoogleClientId,
    client_secret: params.env.GOOGLE_CLIENT_SECRET,
    code: params.code,
    code_verifier: params.codeVerifier,
    redirect_uri: params.redirectUri,
  });

  let tokenRes: Response;
  try {
    tokenRes = await fetchFn(params.env.WORKER_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return {
      ok: false,
      code: 'oauth_network_error',
      userMessage: 'Could not reach Google to exchange authorization. Re-authorize to resume.',
      retryable: true,
    };
  }

  const rawBody = (await tokenRes.json().catch(() => null)) as {
    access_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
    refresh_token?: unknown;
  } | null;

  // Explicitly discard any refresh token if Google ever includes one.
  if (rawBody && 'refresh_token' in rawBody) {
    delete rawBody.refresh_token;
  }

  if (!tokenRes.ok || !rawBody) {
    return {
      ok: false,
      code: `oauth_token_http_${tokenRes.status}`,
      userMessage: 'Google authorization expired before the worker claimed it. Please authorize again.',
      retryable: false,
    };
  }

  const accessToken = typeof rawBody.access_token === 'string' ? rawBody.access_token : '';
  const expiresInSec = typeof rawBody.expires_in === 'number' && Number.isFinite(rawBody.expires_in) ? rawBody.expires_in : 0;
  const scopeStr = typeof rawBody.scope === 'string' ? rawBody.scope : '';
  const scopes = scopeStr.split(/\s+/).filter(Boolean);

  if (!accessToken || expiresInSec <= 0) {
    return {
      ok: false,
      code: 'oauth_missing_token_or_expiry',
      userMessage: 'Google did not return a valid short-lived access token. Please authorize again.',
      retryable: false,
    };
  }

  if (!scopes.includes(GMAIL_SEND_SCOPE)) {
    return {
      ok: false,
      code: 'oauth_missing_scope',
      userMessage: 'Allow Gmail sending permission when authorizing this batch.',
      retryable: false,
    };
  }

  // Verify the authorized Google mailbox strictly matches the batch issuer before sending.
  let userinfoRes: Response;
  try {
    userinfoRes = await fetchFn(params.env.WORKER_OAUTH_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      ok: false,
      code: 'oauth_userinfo_network_error',
      userMessage: 'Google could not verify the authorized Gmail identity. Please authorize again.',
      retryable: true,
    };
  }

  const identity = (await userinfoRes.json().catch(() => null)) as {
    email?: unknown;
    email_verified?: unknown;
  } | null;

  if (!userinfoRes.ok || identity?.email_verified !== true || typeof identity.email !== 'string') {
    return {
      ok: false,
      code: 'oauth_identity_unverified',
      userMessage: 'Google could not verify the authorized Gmail identity. Please authorize again.',
      retryable: false,
    };
  }

  if (identity.email.trim().toLowerCase() !== params.expectedSenderEmail.trim().toLowerCase()) {
    return {
      ok: false,
      code: 'oauth_account_mismatch',
      userMessage: `Authorized Google account did not match issuer account ${params.expectedSenderEmail}. Re-authorize with that account.`,
      retryable: false,
    };
  }

  const expiresAtMs = Date.now() + expiresInSec * 1000;
  return {
    ok: true,
    token: new InMemoryBatchToken(accessToken, expiresAtMs),
    expiresAt: new Date(expiresAtMs),
  };
}
