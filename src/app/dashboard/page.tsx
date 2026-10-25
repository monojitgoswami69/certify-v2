import { connection } from 'next/server';
import DashboardClient from './DashboardClient';

// Rendered per request (not prerendered) so the nonce-based CSP
// (src/proxy.ts) applies to this page's inline bootstrap scripts.
export default async function DashboardPage() {
  await connection();
  return <DashboardClient />;
}
