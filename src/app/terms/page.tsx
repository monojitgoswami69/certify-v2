import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service | Certify',
  description: 'The rules for issuing, verifying, and emailing certificates with Certify.',
  robots: { index: true, follow: true },
};

import { connection } from 'next/server';

export default async function TermsOfServicePage() {
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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-stone-700 font-sans">
            Effective October 15, 2026 · Updated November 25, 2026
          </p>
        </header>

        <div className="mt-8 space-y-10 text-stone-800 text-sm leading-relaxed">
          {/* Section 1 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              1. Using Certify
            </h2>
            <p>
              These terms apply when you use <Link href="/" className="text-primary-800 underline underline-offset-2">Certify</Link>, whether you issue certificates or open a link to verify one. By using Certify, you agree to these terms.
            </p>
          </section>

          {/* Section 2 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              2. Issuing and verifying certificates
            </h2>
            <p>
              In Certify Studio, you can design a template, upload a recipient spreadsheet, and generate certificates in batches. When you register a batch with a verification QR code, anyone with the link can check the certificate. Our <Link href="/privacy" className="text-primary-800 underline underline-offset-2">Privacy Policy</Link> explains what they can see.
            </p>
          </section>

          {/* Section 3 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              3. Your responsibilities as an issuer
            </h2>
            <p>
              Use Certify lawfully. Before you upload a roster or issue a certificate, make sure you have permission to use the artwork and recipient information and the authority to issue the certificate on behalf of the event or organization.
            </p>
            <ul className="list-disc pl-5 space-y-2 text-stone-700">
              <li>
                Collect recipient information lawfully and get consent when it’s required.
              </li>
              <li>
                Issue only accurate certificates you are authorized to issue. Counterfeit and misleading certificates are prohibited.
              </li>
              <li>
                Use the email feature for legitimate certificate delivery. Spam, phishing, and harmful messages are prohibited.
              </li>
            </ul>
          </section>

          {/* Section 4 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              4. Sending certificates through Gmail
            </h2>
            <p>
              If you want to email certificates, connect Gmail using the same Google account you signed in with. Gmail’s sending limits and delivery rules apply. Keep the Studio tab open until your batch finishes.
            </p>
            <p>
              Use the integration in line with <a href="https://policies.google.com/terms" className="text-primary-800 underline underline-offset-2">Google’s Terms of Service</a> and the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="text-primary-800 underline underline-offset-2">Google API Services User Data Policy</a>. You can disconnect Gmail from Studio at any time.
            </p>
          </section>

          {/* Section 5 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              5. Your artwork and data
            </h2>
            <p>
              Uploading artwork, logos, or spreadsheets to Certify does not transfer ownership. You keep the rights you already have in that material.
            </p>
          </section>

          {/* Section 6 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              6. Availability and warranties
            </h2>
            <p>
              Certify is provided “as is” and “as available.” We can’t promise the service will always be available, error-free, or entirely secure. Where the law allows, we disclaim express and implied warranties, including merchantability, fitness for a particular purpose, and non-infringement.
            </p>
          </section>

          {/* Section 7 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              7. Limitation of Liability
            </h2>
            <p>
              To the extent the law allows, Certify and its operators are not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of profits, data, or goodwill arising from using or being unable to use Certify.
            </p>
          </section>

          {/* Section 8 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              8. Changes to these terms
            </h2>
            <p>
              We may update these terms from time to time. When we do, we’ll post the new version here with its effective date. If you keep using Certify after revised terms are published, you agree to the updated terms.
            </p>
          </section>

          {/* Section 9 */}
          <section className="space-y-3">
            <h2 className="section-title text-stone-900">
              9. Contact
            </h2>
            <p>
              For questions about these terms, email{' '}
              <a href="mailto:monojit.goswami.0905@gmail.com" className="text-primary-800 underline underline-offset-2">monojit.goswami.0905@gmail.com</a>.
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
