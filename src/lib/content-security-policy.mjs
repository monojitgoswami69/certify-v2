function getR2Origin() {
  try {
    const url = new URL(process.env.R2_PUBLIC_BASE_URL ?? '');
    if (url.protocol === 'https:') return url.origin;
  } catch {
    // R2 is optional in installations that only accept inline artwork.
  }
  return 'https://assets.wecertify.tech';
}

export function appContentSecurityPolicy(nonce = '') {
  const isDev = process.env.NODE_ENV === 'development';
  const r2Origin = getR2Origin();
  return [
    "default-src 'self'",
    `script-src 'self' ${nonce ? `'nonce-${nonce}'` : "'unsafe-inline'"} https://accounts.google.com${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    `connect-src 'self' data: blob: https://fonts.googleapis.com https://fonts.gstatic.com https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://*.r2.cloudflarestorage.com ${r2Origin}`,
    'frame-src https://accounts.google.com',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
