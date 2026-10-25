import { connection } from 'next/server';
import LoginClient from './LoginClient';

// Rendered per request (not prerendered) so the nonce-based CSP
// (src/proxy.ts) applies to this page's inline bootstrap scripts.
export default async function LoginPage() {
  await connection();
  return <LoginClient />;
}
