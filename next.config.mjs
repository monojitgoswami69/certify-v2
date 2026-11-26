import { appContentSecurityPolicy } from './src/lib/content-security-policy.mjs';

const isDev = process.env.NODE_ENV === 'development';

const securityHeaders = [
  { key: 'Content-Security-Policy', value: appContentSecurityPolicy() },
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
        source: '/:homepage(home\\.html)?',
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
