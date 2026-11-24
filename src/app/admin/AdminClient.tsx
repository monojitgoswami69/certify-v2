'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, KeyRound, LayoutDashboard, RefreshCw } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { CertifyHeader } from '../../components/account/CertifyHeader';
import { apiFetch } from '../../lib/api-client';
import type { ManagedRole } from '../../lib/platform-access';
import { AccessManagement, type AccessRow } from './AccessManagement';
import { AdminOverview, type AccountRow, type Overview } from './AdminOverview';

export default function AdminClient() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, user, initialize, checkAuth } = useAuthStore();

  const [tab, setTab] = useState<'overview' | 'access'>('access');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [access, setAccess] = useState<AccessRow[] | null>(null);
  const [callerRole, setCallerRole] = useState<'admin' | 'super_admin'>('admin');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [overviewResponse, accountsResponse, accessResponse] = await Promise.all([
        apiFetch('/api/admin/overview'),
        apiFetch('/api/admin/accounts'),
        apiFetch('/api/admin/access'),
      ]);
      const responses = [overviewResponse, accountsResponse, accessResponse];
      if (responses.some((response) => response.status === 403)) {
        setForbidden(true);
        setOverview(null);
        setAccounts(null);
        setAccess(null);
        return;
      }
      setForbidden(false);
      if (overviewResponse.ok) setOverview((await overviewResponse.json()).overview);
      if (accountsResponse.ok) setAccounts((await accountsResponse.json()).accounts);
      if (accessResponse.ok) {
        const data = await accessResponse.json();
        setAccess(data.access);
        setCallerRole(data.callerRole);
      }
      if (responses.some((response) => !response.ok)) {
        throw new Error('Some admin data could not be loaded. Try refreshing.');
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not load admin data' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { initialize(); }, [initialize]);

  useEffect(() => {
    if (authLoading) return;
    if (isAuthenticated) void loadAll();
    else router.replace('/login');
  }, [authLoading, isAuthenticated, router, loadAll]);

  async function updateAccess(
    { method, body, email }: {
      method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      body?: object;
      email: string;
    },
    confirmation: string,
    fallback: string
  ) {
    if (saving || loading) return false;
    setSaving(true);
    setMessage(null);
    try {
      const path = method === 'DELETE' ? `/api/admin/access?email=${encodeURIComponent(email)}` : '/api/admin/access';
      const response = await apiFetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify({ email, ...body }) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.detail || fallback);
      setAccess(data.access);
      setCallerRole(data.callerRole);
      if (method === 'PUT' && email === user?.email) await checkAuth();
      setMessage({ ok: true, text: confirmation });
      return true;
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : fallback });
      return false;
    } finally {
      setSaving(false);
    }
  }

  const isCheckingAccess = authLoading || !isAuthenticated;
  const canOpenCertificates = access?.some((account) => account.email === user?.email && account.canIssueCertificates);
  const unavailable = tab === 'access' ? !access : !overview && !accounts;

  return (
    <div className="min-h-screen bg-app-background text-sm text-slate-900">
      <CertifyHeader>
        {!isCheckingAccess && !forbidden && canOpenCertificates && (
          <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-app-border bg-white px-2.5 text-sm font-semibold text-slate-800 hover:bg-app-background hover:text-primary-700 sm:px-3.5">
            <LayoutDashboard className="size-4" aria-hidden="true" />
            Certificates
          </Link>
        )}
      </CertifyHeader>

      <main className="mx-auto w-full max-w-6xl px-4 pt-4 pb-10 sm:px-6 sm:pt-5">
        {isCheckingAccess ? (
          <p role="status" className="text-stone-700">Checking your access…</p>
        ) : forbidden ? (
          <>
            <h1 className="page-title">Admin access required</h1>
            <p className="mt-3 text-stone-700">Access management is available to administrators.</p>
            <Link href="/dashboard" className="mt-4 inline-flex min-h-10 items-center font-semibold text-primary-700 underline">
              Back to certificates
            </Link>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <h1 className="page-title">Admin console</h1>
              <button
                type="button"
                onClick={() => void loadAll()}
                disabled={loading || saving}
                className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-semibold text-primary-800 enabled:hover:bg-primary-50 disabled:text-stone-600"
              >
                <RefreshCw className={`size-4 ${loading ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            <nav aria-label="Admin console" className="mt-2 flex gap-5 border-b border-app-border sm:gap-6">
              {[
                { id: 'access' as const, label: 'Access management', Icon: KeyRound },
                { id: 'overview' as const, label: 'Overview', Icon: BarChart3 },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={tab === id}
                  onClick={() => setTab(id)}
                  className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 text-sm font-medium ${
                    tab === id ? 'border-primary-600 text-primary-800' : 'border-transparent text-stone-700 hover:text-primary-800'
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </nav>

            <div className="pt-5">
              {message && (tab === 'access' || !message.ok) && (
                <p role={message.ok ? 'status' : 'alert'} className={`mb-5 text-sm leading-relaxed font-medium ${message.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                  {message.text}
                </p>
              )}
              {unavailable && loading && <p role="status" className="text-stone-700">Loading {tab === 'access' ? 'accounts' : 'activity'}…</p>}
              {access && (
                <div hidden={tab !== 'access'}>
                  <AccessManagement
                    access={access}
                    callerRole={callerRole}
                    busy={saving || loading}
                    error={message?.ok === false ? message.text : null}
                    onOpenAction={() => setMessage(null)}
                    onGrant={(email: string, role: ManagedRole) => updateAccess(
                      { method: 'POST', email, body: { role } },
                      `Sign-in access saved for ${email}.`,
                      'Could not save sign-in access.'
                    )}
                    onIssue={(email, canIssueCertificates) => updateAccess(
                      { method: 'PUT', email, body: { canIssueCertificates } },
                      `Certificate issuance ${canIssueCertificates ? 'enabled' : 'disabled'} for ${email}.`,
                      'Could not update certificate issuance.'
                    )}
                    onLimits={(email, limits) => updateAccess(
                      { method: 'PATCH', email, body: limits },
                      `Sending limits updated for ${email}.`,
                      'Could not save sending limits.'
                    )}
                    onRevoke={(email) => updateAccess(
                      { method: 'DELETE', email },
                      `Sign-in access revoked for ${email}.`,
                      'Could not revoke sign-in access.'
                    )}
                  />
                </div>
              )}
              {tab === 'overview' && !unavailable && <AdminOverview overview={overview} accounts={accounts} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
