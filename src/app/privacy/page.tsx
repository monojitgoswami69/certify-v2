import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | WeCertify',
  alternates: { canonical: '/privacy' },
  description: 'How WeCertify handles your account, certificate records, and Gmail connection.',
  robots: { index: true, follow: true },
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#FBFAF5] text-stone-900 selection:bg-stone-200 selection:text-stone-900">
      {/* Top minimal bar */}
      <header className="border-b border-stone-200/70 bg-[#FBFAF5]/80 backdrop-blur-xs sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 group"
            title="WeCertify Home"
          >
            <span className="font-jura text-lg font-bold tracking-tight text-stone-900 group-hover:text-stone-700 transition-colors">
              WeCertify
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
            Effective October 15, 2026 · Updated November 25, 2026
          </p>
        </header>

        <div className="mt-8 space-y-10 text-stone-800 text-sm leading-relaxed">
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">1. Your account</h2>
            <p>
              When you sign in with Google, we receive your verified email address, your name, and any profile photo Google provides. We use your email address to check whether you have access to WeCertify, and we save your name and photo for your profile. A session cookie keeps you signed in.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">2. What we save when you create certificates</h2>
            <p>Your browser generates certificate files and ZIP downloads. When you save a template, we store its artwork and layout. Studio drafts can save the recipient spreadsheet, email draft, and layout so you can pick up where you left off.</p>
            <p>When you register a batch, we save the event, its recipient records, and the design. WeCertify uses those records to verify certificates later and recreate them for download.</p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">3. What a verification link shows</h2>
            <p>Anyone with a verification link can check the certificate’s status. A valid certificate can show the recipient’s name, the event, the issuer, and the issue date. If the issuer turns on view counts, WeCertify keeps an aggregate count visible only to the issuer without logging visitor details.</p>
            <p>We leave the recipient’s contact email and private spreadsheet columns out of public verification details. When a download is available, the file can show any information the issuer printed on the certificate.</p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">4. Sending certificates through Gmail</h2>
            <p>Connecting Gmail is optional. If you connect it, we check that the Gmail address matches the Google address you used to sign in. We store the access and refresh tokens from Google in encrypted form so WeCertify can send emails from that account when you ask it to.</p>
            <p>When you start a send, we give Gmail the recipient’s address, your message, and the certificate attachment for delivery. The email comes from your Gmail address.</p>
            <p>
              WeCertify requests only the Gmail send permission (<code className="font-mono text-xs [overflow-wrap:anywhere]">https://www.googleapis.com/auth/gmail.send</code>). This permission lets WeCertify send a message without granting access to your inbox, drafts, or sent mail.
            </p>
            <p>
              We follow the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-primary-800 underline underline-offset-2">Google API Services User Data Policy</a>, including its Limited Use requirements, when we use or transfer information from Google APIs. We never sell Google user data or use it for ads or general-purpose AI training. We limit human access to the circumstances Google allows, such as helping with a specific issue you’ve asked us to look at or meeting a legal obligation.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">5. Disconnecting Gmail or deleting your data</h2>
            <p>Choose <strong>Disconnect Gmail</strong> in Studio to remove the tokens we store and ask Google to revoke WeCertify’s access. You can also revoke access directly in your <a href="https://myaccount.google.com/permissions" className="text-primary-800 underline underline-offset-2">Google Account permissions</a>. Messages you’ve already sent and certificates you’ve already issued stay in place when you disconnect Gmail.</p>
            <p>We keep your account information while you have an account and retain issued certificate records so their links can still be verified. To request deletion of account information, saved workspace data, or data from Google, email the address below.</p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">6. Hosting and security</h2>
            <p>Our hosting and database providers process data on our behalf to run WeCertify. We use HTTPS for connections to the service, encrypt stored Gmail tokens, and check account permissions before opening a private workspace.</p>
          </section>

          <section className="space-y-3">
            <h2 className="section-title text-stone-900">7. Contact</h2>
            <p>For privacy questions or deletion requests, email{' '}
              <a href="mailto:monojit.goswami.0905@gmail.com" className="text-primary-800 underline underline-offset-2">monojit.goswami.0905@gmail.com</a>.
            </p>
          </section>
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-stone-200/70 text-xs text-stone-600 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p>© {new Date().getFullYear()} WeCertify. All rights reserved.</p>
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
