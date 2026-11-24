import type { IssuedEventDesign } from './event-design';
import type { EmailSettings, PersistedMailStatus } from '../types';
import { ISSUANCE_ACCESS_CHANGED_EVENT, ISSUANCE_REQUIRED_HEADER } from './access-role';

/**
 * Authenticated browser requests using the session cookie.
 */

const API_BASE = '/api';

/** The single source of truth for reading the session token client-side. */
export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem('certify_auth_token') || sessionStorage.getItem('certify_session_token');
  } catch {
    return null;
  }
}

function getAuthHeader(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Custom header required on every request the browser makes. The session is
 * an HttpOnly cookie, so this header (which cross-site pages cannot add
 * without a CORS grant we never issue) is the CSRF defense for mutations.
 */
const CSRF_HEADERS = { 'X-Certify-Request': '1' };

/** Browser requests use the session cookie and support legacy bearer sessions. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers({ ...CSRF_HEADERS, ...getAuthHeader() });
  new Headers(init.headers).forEach((value, name) => headers.set(name, value));
  const response = await fetch(path, { ...init, credentials: 'same-origin', headers });
  if (typeof window !== 'undefined' && response.headers.get(ISSUANCE_REQUIRED_HEADER) === '1') {
    window.dispatchEvent(new Event(ISSUANCE_ACCESS_CHANGED_EVENT));
  }
  return response;
}


export interface GoogleAccount {
  email: string;
  name?: string;
  picture?: string;
}

export interface RegisterCertificateItem {
  recipientName: string;
  recipientEmail?: string;
  rowData?: Record<string, string>;
}

export interface RegistrationOutcome {
  id: string;
  status: 'issued' | 'existing' | 'conflict';
}

/** Registers recipients against one immutable issued design. */
export async function registerCertificates(
  items: RegisterCertificateItem[],
  event: { eventId: string; eventName?: string; label?: string; design?: IssuedEventDesign; mailPreferences?: EmailSettings }
): Promise<RegistrationOutcome[]> {
  const response = await apiFetch(`${API_BASE}/certificates/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ certificates: items, ...event }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Failed to register certificates');
  const outcomes = data.outcomes as RegistrationOutcome[] | undefined;
  if (!Array.isArray(outcomes) || outcomes.length !== items.length || outcomes.some(({ id, status }) =>
    typeof id !== 'string' || !['issued', 'existing', 'conflict'].includes(status))) {
    throw new Error('Invalid registration response from server');
  }
  return outcomes;
}

export async function exchangeGoogleCode(code: string): Promise<GoogleAccount> {
  const response = await apiFetch(`${API_BASE}/auth/google/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to connect Google account');
  }

  return response.json();
}

export async function getGoogleConnection(signal: AbortSignal): Promise<GoogleAccount | null> {
  const response = await apiFetch(`${API_BASE}/auth/google/tokens`, {
    signal,
  });
  if (!response.ok) throw new Error('Could not check your Gmail connection');
  const { account } = await response.json();
  return account;
}

export async function disconnectGoogleAccount(): Promise<void> {
  const response = await apiFetch(`${API_BASE}/auth/google/tokens`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Could not disconnect Gmail. Try again.');
}

export class EmailRateLimitError extends Error {
  constructor(message: string, readonly retryAfter: number, readonly source: 'account' | 'gmail') {
    super(message);
  }
}

export interface SendEmailV2Params {
  certificateId: string;
  resendVersion?: string;
  recipientEmail: string;
  emailSubject: string;
  emailBodyPlain: string;
  emailBodyHtml: string;
  filename: string;
  jpgBlob?: Blob;
  pngBlob?: Blob;
  pdfBlob?: Blob;
}

export class EmailUnconfirmedError extends Error {
  constructor(public readonly networkFailure = false) {
    super('Gmail acceptance could not be confirmed. Check Gmail Sent before sending again.');
    this.name = 'EmailUnconfirmedError';
  }
}

export class IssuanceAccessRequiredError extends Error {}

export class EmailDeliveryBlockedError extends Error {
  constructor(message: string, readonly deliveryStatus: PersistedMailStatus) { super(message); }
}

export interface SendEmailResult {
  status: 'success' | 'reconnect_required';
  message: string;
  recipient: string;
}

/**
 * Sends a certificate email. Uses multipart/form-data with raw Blob
 * attachments to avoid ~33% base64 bandwidth inflation. A
 * `reconnect_required` response (HTTP 401) is returned softly instead of
 * throwing so the caller can trigger a reconnection flow.
 */
export async function sendEmailV2(params: SendEmailV2Params): Promise<SendEmailResult> {
  const form = new FormData();
  form.append('certificate_id', params.certificateId);
  if (params.resendVersion) form.append('resend_version', params.resendVersion);
  form.append('recipient_email', params.recipientEmail);
  form.append('email_subject', params.emailSubject);
  form.append('email_body_plain', params.emailBodyPlain);
  form.append('email_body_html', params.emailBodyHtml);
  form.append('filename', params.filename);
  if (params.jpgBlob) form.append('jpg', params.jpgBlob, `${params.filename}.jpg`);
  if (params.pngBlob) form.append('png', params.pngBlob, `${params.filename}.png`);
  if (params.pdfBlob) form.append('pdf', params.pdfBlob, `${params.filename}.pdf`);

  let response: Response;
  try {
    response = await apiFetch(`${API_BASE}/send-email-v2`, { method: 'POST', body: form });
  } catch {
    throw new EmailUnconfirmedError(true);
  }

  const data = await response.json().catch(() => null);
  if (data?.status === 'unconfirmed' || (!data && (response.ok || response.status >= 500))) {
    throw new EmailUnconfirmedError();
  }

  if (!response.ok) {
    if (data?.status === 'delivery_blocked') throw new EmailDeliveryBlockedError(data.detail, data.deliveryStatus);
    if (response.headers.get(ISSUANCE_REQUIRED_HEADER) === '1') {
      throw new IssuanceAccessRequiredError(data?.detail || 'Certificate issuance access is required');
    }
    // Soft signal: Google session expired and needs interactive reconnect.
    if (response.status === 401 && data?.status === 'reconnect_required') {
      return {
        status: 'reconnect_required',
        message: data.detail || 'Google session expired. Please reconnect.',
        recipient: params.recipientEmail,
      };
    }
    if (response.status === 429 && data?.status === 'rate_limited') {
      const seconds = Number(response.headers.get('Retry-After')) || 1;
      const source = data.source === 'account' ? 'account' : 'gmail';
      throw new EmailRateLimitError(`${data.detail} Try again in ${seconds} seconds.`, seconds, source);
    }
    throw new Error(data?.detail || 'Failed to send email');
  }

  if (data?.status !== 'success') throw new EmailUnconfirmedError();
  return {
    status: 'success',
    message: data.message || 'Email accepted by Gmail',
    recipient: params.recipientEmail,
  };
}


export interface EventDesignResponse {
  event: { id: string; name: string; label: string | null; designLocked: boolean };
  design: IssuedEventDesign | null;
  revision: string | null;
  mailPreferences?: EmailSettings | null;
}

export async function saveEventMailPreferences(eventId: string, mailPreferences: EmailSettings) {
  const response = await apiFetch(`${API_BASE}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mailPreferences }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Could not save this event’s email preferences.');
}

export async function reviewCertificateMail(id: string, version: string | null, found: boolean) {
  const response = await apiFetch(`${API_BASE}/certificates/${encodeURIComponent(id)}/mail`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, found }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Could not save this delivery review.');
}

export async function fetchEventDesign(eventId: string, signal?: AbortSignal): Promise<EventDesignResponse> {
  const response = await apiFetch(`/api/events/${encodeURIComponent(eventId)}/design`, { signal, cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || 'Could not load the certificate design');
  return data;
}
