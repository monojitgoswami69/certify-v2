export const SAMPLE_QR_URL = 'https://example.invalid/verify/sample-certificate';
export const PUBLIC_APP_ORIGIN = 'https://wecertify.tech';
export const LEGACY_APP_ORIGIN = 'https://certify-v2.mgbuilds.in';

function parseOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) return url.origin;
  } catch {
    return null;
  }
  return null;
}

export function isPublicOrigin(origin: string | null) {
  return origin === PUBLIC_APP_ORIGIN || origin === LEGACY_APP_ORIGIN;
}

/** Select the public host once, at issuance. Deployment aliases use the configured origin. */
export function selectVerificationOrigin(request: Request, configuredUrl = process.env.NEXT_PUBLIC_APP_URL): string {
  const browserOrigin = parseOrigin(request.headers.get('origin'));
  if (browserOrigin && isPublicOrigin(browserOrigin)) return browserOrigin;
  const requestOrigin = parseOrigin(request.url);
  if (requestOrigin && isPublicOrigin(requestOrigin)) return requestOrigin;

  const configuredOrigin = parseOrigin(configuredUrl);
  if (configuredOrigin) return configuredOrigin;
  if (process.env.NODE_ENV !== 'production' && requestOrigin) {
    const hostname = new URL(requestOrigin).hostname;
    if (['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return requestOrigin;
  }
  return PUBLIC_APP_ORIGIN;
}

/** Pre-cutover production batches used the previous public host. */
export function legacyVerificationOrigin(request: Request, configuredUrl = process.env.NEXT_PUBLIC_APP_URL): string {
  const origin = selectVerificationOrigin(request, configuredUrl);
  return isPublicOrigin(origin) ? LEGACY_APP_ORIGIN : origin;
}

export function buildVerifyUrlFor(id: string, issuedOrigin?: string | null): string {
  const origin = parseOrigin(issuedOrigin)
    ?? parseOrigin(process.env.NEXT_PUBLIC_APP_URL)
    ?? (typeof window !== 'undefined' ? parseOrigin(window.location.origin) : null)
    ?? PUBLIC_APP_ORIGIN;
  return `${origin}/verify/${encodeURIComponent(id)}`;
}
