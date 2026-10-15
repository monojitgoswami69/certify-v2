import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy | Certify',
  description: 'Privacy Policy and Google API Services User Data Policy disclosure for Certify.',
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
          <h1 className="text-3xl sm:text-4xl font-saira font-bold tracking-tight text-stone-950">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-stone-700 font-sans">
            Effective Date: October 15, 2026 · Last Updated: October 2026
          </p>
        </header>

        <div className="mt-8 space-y-10 text-stone-800 text-[15px] sm:text-base leading-relaxed font-sans">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              1. Overview
            </h2>
            <p>
              Certify (&quot;we&quot;, &quot;our&quot;, or &quot;the Service&quot;), accessible at{' '}
              <a
                href="https://certify.mgbuilds.in"
                className="text-stone-900 underline underline-offset-2 hover:text-stone-600 transition-colors"
              >
                https://certify.mgbuilds.in
              </a>
              , provides organizations and event organizers with tools to design, bulk generate, verify, and deliver custom certificates and credentials. We are committed to protecting your privacy and being transparent about how user data is handled.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              2. Information We Collect
            </h2>
            <p>
              Depending on how you interact with Certify, we may process the following types of information:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-stone-700">
              <li>
                <strong className="text-stone-900">Account Credentials:</strong> Administrative session identifiers and credentials used to authenticate authorized operators into the studio workspace.
              </li>
              <li>
                <strong className="text-stone-900">Recipient & Roster Data:</strong> Names, email addresses, and event metadata provided in CSV or spreadsheet files uploaded solely to populate and generate personalized certificates.
              </li>
              <li>
                <strong className="text-stone-900">Google Account Profile:</strong> When you connect your Google Account to send certificate delivery emails via Gmail, we access your basic profile information (email address and display name) strictly to identify the active sender account in the user interface.
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              3. How We Use Collected Information
            </h2>
            <p>We process information solely to perform core functionality requested by you:</p>
            <ul className="list-disc pl-5 space-y-2 text-stone-700">
              <li>Rendering personalized text, QR verification codes, and graphical certificate assets.</li>
              <li>Maintaining cryptographic verification records for issued credentials on the public registry.</li>
              <li>
                Dispatching generated certificate attachments directly to designated recipient email addresses via your connected Gmail account upon your explicit instruction.
              </li>
            </ul>
          </section>

          {/* Section 4: Google API Disclosure */}
          <section className="space-y-3 pt-2">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              4. Google API Services & Limited Use Disclosure
            </h2>
            <p>
              Certify integrates with the Gmail API via the restricted scope{' '}
              <code className="text-xs bg-stone-100 px-1.5 py-0.5 rounded text-stone-800 font-mono">
                https://www.googleapis.com/auth/gmail.send
              </code>{' '}
              to send outgoing emails containing generated credentials on your behalf.
            </p>
            <div className="border-l-2 border-stone-400 pl-4 py-1 text-stone-800 space-y-2">
              <p className="font-medium text-stone-950">
                Certify&apos;s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 text-stone-950 hover:text-stone-600 transition-colors"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-stone-700 text-sm">
                <li>
                  <strong>Send-Only Access:</strong> We strictly request send-only permission. We do <em>not</em> read, inspect, store, or monitor your personal emails, inbox messages, drafts, or email metadata.
                </li>
                <li>
                  <strong>No Commercial Sharing:</strong> We do not sell, rent, or transfer Google user data to data brokers, advertising networks, or any third parties.
                </li>
                <li>
                  <strong>No Model Training:</strong> Google user data is never used to train generalized artificial intelligence or machine learning models.
                </li>
                <li>
                  <strong>Human Access:</strong> No human will read or inspect your email data unless you have given explicit consent for debugging a specific issue, or as required by law.
                </li>
              </ul>
            </div>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              5. Data Retention & Revocation
            </h2>
            <p>
              You maintain full control over your connected accounts and uploaded data:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-stone-700">
              <li>
                <strong>Immediate Disconnect:</strong> You may disconnect your Google Account at any time directly in the Certify email interface, which immediately clears and invalidates server-held authorization credentials.
              </li>
              <li>
                <strong>Google Account Permissions:</strong> You can revoke Certify&apos;s access at any moment through your{' '}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-stone-600 transition-colors"
                >
                  Google Account Security Permissions
                </a>
                .
              </li>
              <li>
                <strong>Client-Side Processing:</strong> Certificate image rendering and ZIP archiving occur directly within your browser&apos;s local memory without uploading template source files to persistent external storage.
              </li>
            </ul>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              6. Data Security
            </h2>
            <p>
              We implement industry-standard administrative, physical, and technical measures to protect your information, including HTTPS encryption in transit, strict Content Security Policies, cryptographic token hashing for public verification endpoints, and minimal credential retention.
            </p>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              7. Contact Us
            </h2>
            <p>
              If you have any questions or inquiries regarding this Privacy Policy or our data practices, please contact us at:
            </p>
            <p className="font-mono text-sm text-stone-800">
              Email: contact@mgbuilds.in
              <br />
              Website: https://certify.mgbuilds.in
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
