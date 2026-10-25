import { connection } from 'next/server';
import RootClient from './RootClient';

// Rendered per request (not prerendered) so the nonce-based CSP
// (src/proxy.ts) applies to this page's inline bootstrap scripts.
export default async function RootPage() {
  await connection();
  return <RootClient />;
}
