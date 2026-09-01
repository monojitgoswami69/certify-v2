import type { Metadata } from 'next';
import { VerifyClient } from './VerifyClient';

export const metadata: Metadata = {
  title: 'Certificate Verification | Credify',
  description: 'Verify the authenticity of a certificate issued through Credify.',
  robots: { index: false },
};

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-3 sm:p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200/90 shadow-sm px-4 py-5 sm:px-8 sm:py-6">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3 sm:pb-4 mb-2">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
          </svg>
          <span className="font-bold text-slate-800 tracking-tight">Credify</span>
          <span className="ml-auto text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Official Verification
          </span>
        </div>
        <VerifyClient id={id} />
      </div>
      <p className="mt-4 text-xs text-slate-400 text-center max-w-sm px-4">
        Certificates are cryptographically verified against the issuer&apos;s official registry in real time.
      </p>
    </div>
  );
}
