const isDev = process.env.NODE_ENV === 'development';

// The Content-Security-Policy lives in src/proxy.ts (per-request nonce so
// script-src needs no 'unsafe-inline'). This list carries the remaining
// security headers for every route, including /api.
const securityHeaders = [
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
    return [
      { source: '/privacy-policy', destination: '/privacy' },
      { source: '/terms-of-service', destination: '/terms' },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
