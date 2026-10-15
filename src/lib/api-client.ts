/**
 * Authenticated API Client with JWT Bearer Token Injection
 */

const API_BASE = '/api';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token =
    localStorage.getItem('certify_auth_token') ||
    sessionStorage.getItem('certify_session_token') ||
    localStorage.getItem('credify_auth_token') ||
    sessionStorage.getItem('credify_session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface GoogleAccount {
  email: string;
  name?: string;
  picture?: string;
  accessToken?: string;
}

export interface RegisterCertificateItem {
  recipientName: string;
  recipientEmail?: string;
  rowData?: Record<string, string>;
  templateName?: string;
  eventName?: string;
  isStatic?: boolean;
}

/**
 * Bulk-registers certificates on the server before QR rendering. Returns the
 * raw verification UUIDs in input order.
 */
export async function registerCertificates(
  items: RegisterCertificateItem[],
  eventName?: string,
  isStatic?: boolean
): Promise<string[]> {
  const response = await fetch(`${API_BASE}/certificates/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify({ certificates: items, eventName, isStatic }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || 'Failed to register certificates');
  }
  const ids: unknown = data.ids;
  if (!Array.isArray(ids) || ids.length !== items.length || !ids.every((id) => typeof id === 'string' && id)) {
    throw new Error('Invalid registration response from server');
  }
  return ids as string[];
}

export async function exchangeGoogleCode(code: string): Promise<GoogleAccount> {
  const response = await fetch(`${API_BASE}/auth/google/tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify({ code }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || 'Failed to connect Google account');
  }

  return response.json();
}

/** Best-effort: the local disconnect must still succeed when the server is unreachable. */
export async function disconnectGoogleAccount(): Promise<void> {
  await fetch(`${API_BASE}/auth/google/tokens`, {
    method: 'DELETE',
    headers: getAuthHeader(),
  }).catch(() => undefined);
}

export interface SendEmailV2Params {
  recipientEmail: string;
  emailSubject: string;
  emailBodyPlain: string;
  emailBodyHtml: string;
  filename: string;
  jpgBlob?: Blob;
  pngBlob?: Blob;
  pdfBlob?: Blob;
  googleAccessToken?: string;
  senderEmail?: string;
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
  form.append('recipient_email', params.recipientEmail);
  form.append('email_subject', params.emailSubject);
  form.append('email_body_plain', params.emailBodyPlain);
  form.append('email_body_html', params.emailBodyHtml);
  form.append('filename', params.filename);
  if (params.googleAccessToken) form.append('google_access_token', params.googleAccessToken);
  if (params.senderEmail) form.append('sender_email', params.senderEmail);
  if (params.jpgBlob) form.append('jpg', params.jpgBlob, `${params.filename}.jpg`);
  if (params.pngBlob) form.append('png', params.pngBlob, `${params.filename}.png`);
  if (params.pdfBlob) form.append('pdf', params.pdfBlob, `${params.filename}.pdf`);

  const response = await fetch(`${API_BASE}/send-email-v2`, {
    method: 'POST',
    headers: getAuthHeader(),
    body: form,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Soft signal: Google session expired and needs interactive reconnect.
    if (response.status === 401 && data?.status === 'reconnect_required') {
      return {
        status: 'reconnect_required',
        message: data.detail || 'Google session expired. Please reconnect.',
        recipient: params.recipientEmail,
      };
    }
    throw new Error(data.detail || 'Failed to send email');
  }

  return {
    status: 'success',
    message: data.message || 'Email sent',
    recipient: params.recipientEmail,
  };
}

