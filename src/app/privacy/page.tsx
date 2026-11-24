import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Certify',
  description: 'Privacy Policy and Google API Services User Data Policy disclosure for Certify.',
  robots: { index: true, follow: true },
};

import { connection } from 'next/server';

export default async function PrivacyPolicyPage() {
  await connection();
  return (
    <div className="min-h-screen bg-[#FBFAF5] text-stone-900 selection:bg-stone-200 selection:text-stone-900">
      {/* Top minimal bar */}
      <header className="border-b border-stone-200/70 bg-[#FBFAF5]/80 backdrop-blur-xs sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 group"
            title="Certify Home"
          >
            <span className="font-jura text-lg font-bold tracking-tight text-stone-900 group-hover:text-stone-700 transition-colors">
              certify
            </span>
          </Link>
          <span className="text-xs font-mono text-stone-600">
            Legal
          </span>
        </div>
      </header>

      {/* Main Editorial Content */}
      <main className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
        <header className="pb-8 border-b border-stone-200/70">
          <h1 className="page-title text-stone-950">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-stone-700 font-sans">
            Effective October 15, 2026 · Updated November 24, 2026
          </p>
        </header>

        <div className="mt-8 space-y-10 text-stone-800 text-sm leading-relaxed">
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">1. Overview</h2>
            <p>
              <Link href="/" className="text-primary-800 underline underline-offset-2">Certify</Link>{' '}
              helps event organizers design, generate, verify, and deliver certificates. This policy covers the account, certificate, and Gmail data used to provide those features.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">2. Information we collect</h2>
            <ul className="list-disc space-y-2 pl-5 text-stone-700">
              <li><strong>Google sign-in.</strong> Google provides your verified email address, name, and profile photo when available. Certify uses those details to check whether you can sign in, maintain your account, and show your profile. A session cookie keeps you signed in.</li>
              <li><strong>Certificate and recipient data.</strong> Certify processes the roster, artwork, layouts, and event details you provide. Saving templates or drafts can store artwork, layouts, or recipient information on our servers. Registering certificates stores event and recipient records and the design needed to reproduce issued certificates.</li>
              <li><strong>Optional Gmail connection.</strong> If you authorize Gmail, Certify checks that Google verifies the same email address you used to sign in. Certify encrypts its stored Gmail access and refresh tokens and uses them to send the certificate emails you initiate.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">3. How we use and share information</h2>
            <ul className="list-disc space-y-2 pl-5 text-stone-700">
              <li>Certify renders certificate files and packages ZIP downloads in your browser. It stores registered records so recipients can verify or download issued certificates.</li>
              <li>Anyone with a valid public verification link can see certificate details such as the recipient name, event, and issuer. When a download is available, it can include the fields printed on the certificate. Private roster fields and recipient email addresses stay out of the public verification response.</li>
              <li>When you initiate a send, Certify processes the recipient address, message, and certificate attachment and submits them to Google’s Gmail API for delivery. The recipient receives the message and sender address.</li>
              <li>Hosting and database providers process data on Certify’s behalf to operate the service. Certify does not sell Google user data or use it for advertising or generalized AI model training.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">4. Google API Services and Limited Use</h2>
            <p>
              Certify requests the sensitive, send-only Gmail scope{' '}
              <code className="font-mono text-xs [overflow-wrap:anywhere]">https://www.googleapis.com/auth/gmail.send</code>{' '}
              to send the certificate emails you start. Certify does not read your inbox, drafts, or Gmail history.
            </p>
            <p>
              Certify&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
              <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-primary-800 underline underline-offset-2">
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements.
            </p>
            <p>Certify limits human access to Google user data in accordance with Google’s Limited Use requirements, such as troubleshooting with your permission or complying with a legal obligation.</p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">5. Retention, deletion, and revocation</h2>
            <ul className="list-disc space-y-2 pl-5 text-stone-700">
              <li><strong>Disconnecting Gmail.</strong> Certify stores Gmail credentials while Gmail is connected. Selecting <strong>Disconnect Gmail</strong> in the email interface removes those credentials from Certify and requests revocation with Google.</li>
              <li>You can also revoke Certify’s access through your{' '}
                <a href="https://myaccount.google.com/permissions" className="text-primary-800 underline underline-offset-2">Google Account permissions</a>.
              </li>
              <li>Certify keeps account information while your account exists and keeps issued records to support verification. Contact us to request deletion of your account information, saved data, or Google user data. Disconnecting Gmail does not delete sent messages or issued records.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">6. Data security</h2>
            <p>Certify uses HTTPS for data in transit, encrypts stored Gmail tokens, and checks account permissions before exposing private workspace data. Public verification identifiers are checked against stored hashes.</p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">7. Contact</h2>
            <p>For questions about this policy or to request data deletion, email{' '}
              <a href="mailto:monojit.goswami.0905@gmail.com" className="text-primary-800 underline underline-offset-2">monojit.goswami.0905@gmail.com</a>.
            </p>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-stone-200/70 text-xs text-stone-600 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} Certify. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link href="/terms" className="hover:text-stone-900 underline underline-offset-2 transition-colors">
              Terms of Service
            </Link>
            <Link href="/" className="hover:text-stone-900 transition-colors">
              Home
            </Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
