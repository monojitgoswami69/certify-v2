'use client';

import { ChevronLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';

export function SidebarHeader() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventParam = searchParams.get('event');
  const fromParam = searchParams.get('from');
  const isFromEvent = fromParam === 'event' && Boolean(eventParam);
  const backLabel = isFromEvent && eventParam ? `Back to ${eventParam}` : 'Back to Dashboard';

  const handleBack = () => {
    // Navigation Stack Logic:
    // If opened from an existing event's detailed view (from=event):
    // return back to that event's detailed view.
    // Otherwise (Home -> Studio, fresh creation, or newly registered event batch):
    // ALWAYS return to Home dashboard (/dashboard).
    if (isFromEvent && eventParam) {
      router.push(`/dashboard?event=${encodeURIComponent(eventParam)}`);
    } else {
      router.push('/dashboard');
    }
  };

  return (
    <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-100 flex-shrink-0">
      <div className="flex items-center gap-2">
        {/* Dedicated Back Arrowhead to Event View / Dashboard */}
        <button
          onClick={handleBack}
          className="flex items-center justify-center text-slate-500 hover:text-slate-900 transition-all hover:-translate-x-0.5 active:scale-90 cursor-pointer shrink-0 p-1 -ml-1 rounded-lg hover:bg-slate-200/70"
          title={backLabel}
          aria-label={backLabel}
        >
          <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
        </button>

        {/* Certify Branding */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Image
            src="/certify-logo.webp"
            alt="Certify Logo"
            width={28}
            height={28}
            className="w-7 h-7 object-contain shrink-0"
          />
          <h1 className="text-[18px] font-jura font-bold text-slate-900 tracking-tight leading-none font-[700]">
            Certify
          </h1>
        </div>
      </div>
    </div>
  );
}
