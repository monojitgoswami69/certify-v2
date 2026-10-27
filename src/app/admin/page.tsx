import { connection } from 'next/server';
import AdminClient from './AdminClient';

// Rendered per request (not prerendered) so the nonce-based CSP
// (src/proxy.ts) applies to this page's inline bootstrap scripts.
export default async function AdminPage() {
  await connection();
  return <AdminClient />;
}
