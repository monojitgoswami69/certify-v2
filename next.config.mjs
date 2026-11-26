const isDev = process.env.NODE_ENV === 'development';

const r2PublicOrigin = (() => {
  try {
    return process.env.R2_PUBLIC_BASE_URL ? new URL(process.env.R2_PUBLIC_BASE_URL).origin : 'https://assets.wecertify.tech';
  } catch {
    return 'https://assets.wecertify.tech';
  }
})();

// Static Content Security Policy served alongside CDN-cached HTML so pages do
// not require per-request SSR nonces just to hydrate Next.js bootstrap scripts.
// The static homepage (`/`) overrides this with an even tighter scriptless policy.
const appContentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://accounts.google.com${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' data: blob: https://fonts.googleapis.com https://fonts.gstatic.com https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://*.r2.cloudflarestorage.com ${r2PublicOrigin}`,
  'frame-src https://accounts.google.com',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: appContentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
  // Google's OAuth popup needs to postMessage back to the opener
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ['image/avif', 'image/webp'],
    qualities: [75, 80],
    minimumCacheTTL: 31536000,
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/home.html' },
      ],
      afterFiles: [
        { source: '/privacy-policy', destination: '/privacy' },
        { source: '/terms-of-service', destination: '/terms' },
      ],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        source: '/',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
