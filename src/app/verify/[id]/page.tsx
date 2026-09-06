import type { Metadata } from 'next';
import Image from 'next/image';
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
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3 sm:pb-4 mb-2">
          <Image
            src="/credify-logo.png"
            alt="Credify Logo"
            width={26}
            height={26}
            className="w-6.5 h-6.5 object-contain shrink-0"
          />
          <span className="font-bold text-slate-800 tracking-tight text-base">Credify</span>
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
