import { connection } from 'next/server';
import EditorClient from './EditorClient';

// Rendered per request (not prerendered) so the nonce-based CSP
// (src/proxy.ts) applies to this page's inline bootstrap scripts.
export default async function CertificateStudioPage() {
  await connection();
  return <EditorClient />;
}
