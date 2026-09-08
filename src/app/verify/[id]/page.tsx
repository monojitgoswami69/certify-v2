import type { Metadata } from 'next';
import Link from 'next/link';
import { VerifyClient } from './VerifyClient';

export const metadata: Metadata = {
  title: 'Certificate Verification | Certify Registry',
  description: 'Authenticate and inspect the official cryptographic record of this issued credential.',
  robots: { index: false },
};

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const issuedBy = process.env.ISSUED_BY || process.env.NEXT_PUBLIC_ISSUED_BY || 'Certify';

  return (
    <div className="min-h-screen bg-[#FBFAF5] relative flex items-center justify-center text-slate-900 selection:bg-emerald-100 selection:text-emerald-900 px-4 sm:px-6 py-12 overflow-x-hidden">
      {/* Subtle ambient illumination beam */}
      <div
        className="absolute top-0 inset-x-0 h-[420px] bg-[radial-gradient(ellipse_70%_55%_at_50%_0%,rgba(16,185,129,0.065),transparent)] pointer-events-none"
        aria-hidden="true"
      />

      {/* Perfectly centered certificate inspection content */}
      <main className="w-full max-w-2xl mx-auto flex flex-col items-center justify-center relative z-10">
        <VerifyClient id={id} defaultIssuedBy={issuedBy} />
      </main>

      {/* Powered by Certify typographic lockup - always at bottom-right */}
      <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-8 z-30 select-none print:hidden">
        <Link
          href="/"
          className="inline-flex items-baseline gap-1.5 text-stone-500 hover:text-stone-900 transition-colors group"
          title="Certify — Verification Registry"
        >
          <span className="text-[11px] sm:text-xs font-quicksand font-semibold tracking-wide text-stone-500 group-hover:text-stone-700">
            powered by
          </span>
          <span className="text-xs sm:text-sm font-jura font-bold tracking-tight text-stone-800 group-hover:text-stone-950 font-[700]">
            certify
          </span>
        </Link>
      </div>
    </div>
  );
}
