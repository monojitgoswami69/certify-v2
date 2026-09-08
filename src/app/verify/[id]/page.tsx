import type { Metadata } from 'next';
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
    <div className="min-h-screen bg-[#FBFAF5] relative flex flex-col items-center justify-center text-slate-900 selection:bg-emerald-100 selection:text-emerald-900 px-4 sm:px-6 py-12 sm:py-20 overflow-x-hidden">
      {/* Subtle ambient illumination beam */}
      <div
        className="absolute top-0 inset-x-0 h-[420px] bg-[radial-gradient(ellipse_70%_55%_at_50%_0%,rgba(16,185,129,0.065),transparent)] pointer-events-none"
        aria-hidden="true"
      />
      <main className="w-full max-w-2xl mx-auto flex flex-col items-center relative z-10">
        <VerifyClient id={id} defaultIssuedBy={issuedBy} />
      </main>
    </div>
  );
}
