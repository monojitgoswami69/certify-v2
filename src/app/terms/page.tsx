import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service | Certify',
  description: 'Terms of Service and acceptable use conditions for Certify.',
  robots: { index: true, follow: true },
};

export default function TermsOfServicePage() {
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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-stone-700 font-sans">
            Effective Date: October 15, 2026 · Last Updated: October 2026
          </p>
        </header>

        <div className="mt-8 space-y-10 text-stone-800 text-[15px] sm:text-base leading-relaxed font-sans">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using Certify (&quot;the Service&quot;), hosted at{' '}
              <a
                href="https://certify.mgbuilds.in"
                className="text-stone-900 underline underline-offset-2 hover:text-stone-600 transition-colors"
              >
                https://certify.mgbuilds.in
              </a>
              , you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, you may not access or use the Service.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              2. Description of the Service
            </h2>
            <p>
              Certify is a software utility designed for event organizers, educational institutions, and organizations to create certificate templates, batch generate credentials from spreadsheets, register verifiable credentials, and dispatch certificates to recipients via email.
            </p>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              3. Permitted & Acceptable Use
            </h2>
            <p>
              You agree to use Certify only for lawful purposes and in accordance with these Terms. You represent and warrant that:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-stone-700">
              <li>
                You possess all necessary rights, permissions, and authority to issue certificates and credentials on behalf of the represented organization or event.
              </li>
              <li>
                All recipient information uploaded into the Service was gathered lawfully and with the requisite consent of the recipients.
              </li>
              <li>
                You will not use the Service to generate counterfeit, fraudulent, misleading, or unauthorized certifications.
              </li>
              <li>
                You will not use the Service or connected email integrations to transmit unsolicited bulk email (&quot;spam&quot;), phishing campaigns, or harmful content.
              </li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              4. Third-Party Integrations & Google APIs
            </h2>
            <p>
              Certify provides optional integration with Google OAuth and the Gmail API to send generated credentials directly from your email account. When using Google integrations:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-stone-700">
              <li>
                You agree to comply with Google&apos;s Terms of Service and the Google API Services User Data Policy.
              </li>
              <li>
                You acknowledge that email delivery speed and quota limits are governed by Google&apos;s API policies and your Google Workspace / Gmail account tier.
              </li>
              <li>
                You can disconnect your Google Account from Certify at any time.
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              5. Intellectual Property & User Content
            </h2>
            <p>
              You retain all ownership, intellectual property rights, and copyright in the graphics, logos, certificate artwork, and participant datasets you upload to the Service. Certify does not claim any proprietary interest in your content.
            </p>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              6. Disclaimer of Warranties
            </h2>
            <p>
              The Service is provided on an &quot;AS IS&quot; and &quot;AS AVAILABLE&quot; basis, without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or entirely secure.
            </p>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              7. Limitation of Liability
            </h2>
            <p>
              To the maximum extent permitted by applicable law, Certify and its operators shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits, data, or goodwill arising from your use of or inability to use the Service.
            </p>
          </section>

          {/* Section 8 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              8. Modifications to Terms
            </h2>
            <p>
              We reserve the right to modify these Terms at any time. Any changes will be posted directly to this page with an updated effective date. Your continued use of the Service after changes are published constitutes your acceptance of the revised Terms.
            </p>
          </section>

          {/* Section 9 */}
          <section className="space-y-3">
            <h2 className="text-xl font-saira font-semibold text-stone-900">
              9. Contact Information
            </h2>
            <p>
              For any questions regarding these Terms of Service, please contact:
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
            <Link href="/privacy" className="hover:text-stone-900 underline underline-offset-2 transition-colors">
              Privacy Policy
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
