'use client';

import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export function SidebarHeader() {
  const router = useRouter();

  return (
    <div className="px-3.5 py-3 border-b border-slate-200 bg-white flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* Dedicated Back Arrowhead to Dashboard */}
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center justify-center text-slate-500 hover:text-slate-900 transition-all hover:-translate-x-0.5 active:scale-90 cursor-pointer shrink-0 p-0.5"
          title="Back to Dashboard"
          aria-label="Back to Dashboard"
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
        </button>

        {/* Credify Branding */}
        <div className="flex items-center gap-2 min-w-0">
          <Image
            src="/credify-logo.png"
            alt="Credify Logo"
            width={28}
            height={28}
            className="w-7 h-7 object-contain shrink-0"
          />
          <h1 className="text-[18px] font-bold text-slate-900 tracking-tight leading-none">
            Credify
          </h1>
        </div>
      </div>
    </div>
  );
}
