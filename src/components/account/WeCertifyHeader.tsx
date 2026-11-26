import type { ReactNode } from 'react';
import Image from 'next/image';
import { AccountMenu } from './AccountMenu';

export function WeCertifyHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="relative z-30 flex shrink-0 items-center justify-between gap-2 border-b border-app-border bg-app-header px-4 py-2 sm:gap-4 sm:px-6 sm:py-2.5">
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
        <Image src="/wecertify-logo.png" alt="" width={48} height={48} loading="eager" className="size-10 shrink-0 object-contain sm:size-11" />
        <div>
          <span className="font-jura text-lg leading-tight font-bold text-slate-900">WeCertify</span>
          <p className="mt-0.5 hidden text-sm leading-tight text-stone-700 md:block">
            Certificate Verification &amp; Registry
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <AccountMenu />
      </div>
    </header>
  );
}
