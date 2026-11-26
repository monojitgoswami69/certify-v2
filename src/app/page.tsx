import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { connection } from 'next/server';
import SignedInRedirect from './RootClient';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

// Rendered per request (not prerendered) so the nonce-based CSP
// (src/proxy.ts) applies to this page's inline bootstrap scripts.
export default async function RootPage() {
  await connection();
  return (
    <div className="min-h-screen bg-app-background text-slate-900">
      <SignedInRedirect />
      <header className="border-b border-app-border bg-app-header">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-2.5 sm:px-6">
          <Image src="/wecertify-logo.png" alt="" width={44} height={44} loading="eager" />
          <span className="font-jura text-lg font-bold">WeCertify</span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="max-w-xl text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          Design, issue, and verify certificates
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-stone-700 sm:text-base">
          WeCertify helps event organizers create personalized certificates from a template and a recipient list.
          Register certificates with a verification link, export them in bulk, or email them through your connected Gmail account.
        </p>
        <Link href="/login" className="mt-6 inline-flex min-h-10 items-center rounded-md bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
          Sign in
        </Link>
        <p className="mt-3 text-sm text-stone-700">An administrator must first approve your sign-in email.</p>

        <div className="mt-10 grid gap-5 border-t border-app-border pt-6 sm:grid-cols-3 sm:gap-8">
          <section>
            <h2 className="section-title">Create a batch</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-700">Add your artwork and map fields from a CSV roster in Canvas Studio.</p>
          </section>
          <section>
            <h2 className="section-title">Verify a certificate</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-700">Recipients can open the link or scan the QR code on a registered certificate to check its status.</p>
          </section>
          <section>
            <h2 className="section-title">Deliver certificates</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-stone-700">Download a batch or authorize Gmail to send certificates from the address you use to sign in.</p>
          </section>
        </div>
      </main>
      <footer className="mx-auto max-w-6xl px-4 sm:px-6">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-3 border-t border-app-border py-5 text-sm">
          <Link href="/privacy" className="font-medium text-primary-800 underline underline-offset-4">Privacy Policy</Link>
          <Link href="/terms" className="font-medium text-primary-800 underline underline-offset-4">Terms of Service</Link>
        </nav>
      </footer>
    </div>
  );
}
