'use client';

import type { ReactNode } from 'react';
import { clsx } from 'clsx';

interface StepCardProps {
  number: number;
  title: string;
  status: 'pending' | 'active' | 'completed';
  children: ReactNode;
}

export function StepCard({ number, title, status, children }: StepCardProps) {
  const isCollapsed = status === 'pending';

  return (
    <div
      className={clsx(
        'rounded-xl border transition-all duration-300 shadow-xs relative',
        isCollapsed ? 'overflow-hidden' : 'overflow-visible',
        status === 'completed' && 'bg-slate-50/60 border-slate-200 hover:border-slate-300',
        status === 'active' && 'bg-white border-slate-300 shadow-xs',
        status === 'pending' && 'bg-slate-50/40 border-slate-200/60 opacity-60'
      )}
      style={{ zIndex: status === 'active' ? 30 : 20 - number * 2 }}
    >
      <div
        className={clsx(
          'flex items-center gap-2.5 px-3.5 py-2.5 transition-colors rounded-t-xl',
          status === 'completed' && 'bg-slate-100/60 border-b border-slate-200/70',
          status === 'active' && 'bg-slate-50/90 border-b border-slate-200',
          status === 'pending' && isCollapsed ? 'rounded-b-xl' : 'border-b border-slate-100'
        )}
      >
        <span
          className={clsx(
            'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 shadow-2xs',
            status === 'completed' && 'bg-emerald-500 text-white',
            status === 'active' && 'bg-primary-600 text-white',
            status === 'pending' && 'bg-slate-200 text-slate-500'
          )}
        >
          {status === 'completed' ? '✓' : number}
        </span>
        <h3
          className={clsx(
            'font-bold text-sm truncate',
            status === 'pending' ? 'text-slate-400' : 'text-slate-900'
          )}
        >
          {title}
        </h3>
      </div>

      <div
        className={clsx(
          'transition-all duration-300',
          isCollapsed ? 'max-h-0 opacity-0 overflow-hidden' : 'max-h-[2000px] opacity-100 overflow-visible'
        )}
      >
        <div className="p-3.5 space-y-3">{children}</div>
      </div>
    </div>
  );
}
