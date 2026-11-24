'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/useAuthStore';
import { canManageAccess, ISSUANCE_ACCESS_CHANGED_EVENT } from '../../lib/access-role';
import { CertifyHeader } from './CertifyHeader';

export function IssuerWorkspace({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isAuthenticated, isLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    const refreshAccess = () => { void checkAuth(); };
    const accessDenied = () => {
      const { user } = useAuthStore.getState();
      if (user?.canIssueCertificates) {
        useAuthStore.setState({ user: { ...user, canIssueCertificates: false } });
      }
      refreshAccess();
    };
    refreshAccess();
    window.addEventListener('focus', refreshAccess);
    window.addEventListener(ISSUANCE_ACCESS_CHANGED_EVENT, accessDenied);
    return () => {
      window.removeEventListener('focus', refreshAccess);
      window.removeEventListener(ISSUANCE_ACCESS_CHANGED_EVENT, accessDenied);
    };
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen grid place-items-center" role="status">
        <p className="text-sm text-stone-600">Checking your access…</p>
      </div>
    );
  }
  if (user?.canIssueCertificates === true) return children;

  return (
    <div className="min-h-screen bg-app-background text-sm">
      <CertifyHeader />
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
        <h1 className="page-title text-slate-900">Certificate issuance access required</h1>
        {canManageAccess(user?.platformRole) ? (
          <Link href="/admin" className="mt-5 inline-flex min-h-10 items-center font-semibold text-primary-700 underline">
            Manage access
          </Link>
        ) : (
          <>
            <p className="mt-3 leading-relaxed text-stone-700">Ask an administrator to enable certificate issuance for your account.</p>
            <button type="button" onClick={() => void checkAuth()} className="mt-3 min-h-10 font-semibold text-primary-700 underline">
              Check access again
            </button>
          </>
        )}
      </main>
    </div>
  );
}
