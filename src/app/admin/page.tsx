'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ShieldCheck,
  RefreshCw,
  UserPlus,
  Trash2,
  BarChart3,
  KeyRound,
  LayoutDashboard,
  Eye,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { getAuthToken } from '../../lib/api-client';

interface Overview {
  accounts: number;
  newAccounts30d: number;
  events: number;
  certificates: number;
  activeCertificates: number;
  revokedCertificates: number;
  totalViews: number;
  templates: number;
  batches: number;
  certs7d: number;
  certs30d: number;
}

interface AccountRow {
  email: string;
  role: string;
  createdAt: string | null;
  eventCount: number;
  certificateCount: number;
  activeCount: number;
  revokedCount: number;
  totalViews: number;
  lastIssuedAt: string | null;
  lastActiveAt: string | null;
}

interface AccessRow {
  email: string;
  role: 'user' | 'admin' | 'super_admin';
  createdAt: string;
}

/**
 * Admin console — a separate surface from the dashboard/studio. Shows
 * platform analytics and manages the sign-in allowlist. Analytics are
 * strictly aggregate: recipient data never appears here.
 */
function AdminClient() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading, initialize } = useAuthStore();

  const [tab, setTab] = useState<'overview' | 'access'>('overview');
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [callerRole, setCallerRole] = useState<'admin' | 'super_admin'>('admin');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const authedFetch = useCallback(async (path: string, init?: RequestInit) => {
    const token = getAuthToken();
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        'X-Certify-Request': '1',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...init,
    });
    return res;
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, acRes, axRes] = await Promise.all([
        authedFetch('/api/admin/overview'),
        authedFetch('/api/admin/accounts'),
        authedFetch('/api/admin/access'),
      ]);
      if (ovRes.status === 403 || acRes.status === 403) {
        setForbidden(true);
        return;
      }
      if (ovRes.ok) setOverview((await ovRes.json()).overview);
      if (acRes.ok) setAccounts((await acRes.json()).accounts);
      if (axRes.ok) {
        const data = await axRes.json();
        setAccess(data.access ?? []);
        setCallerRole(data.callerRole ?? 'admin');
      }
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
    if (!authLoading && isAuthenticated) void loadAll();
  }, [authLoading, isAuthenticated, router, loadAll]);

  const saveAccess = async () => {
    if (!newEmail.trim() || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await authedFetch('/api/admin/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Failed to update access');
      setAccess(data.access ?? []);
      setCallerRole(data.callerRole ?? callerRole);
      setNewEmail('');
      setMessage({ ok: true, text: `${newEmail.trim()} can now access the platform.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setSaving(false);
    }
  };

  const removeAccess = async (email: string) => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await authedFetch(`/api/admin/access?email=${encodeURIComponent(email)}`, {
        method: 'DELETE',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Failed to remove access');
      setAccess(data.access ?? []);
      setMessage({ ok: true, text: `${email} can no longer sign in.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-6 h-6 animate-spin text-stone-400" />
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <ShieldCheck className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <h1 className="font-jura font-bold text-xl text-stone-900">Admin access required</h1>
          <p className="text-sm text-stone-500 mt-1.5 font-quicksand">
            This console is limited to accounts your organization's admin has elevated.
          </p>
        </div>
      </div>
    );
  }

  const tiles = overview
    ? [
        { label: 'Accounts', value: overview.accounts, sub: `+${overview.newAccounts30d} in 30 days` },
        { label: 'Events', value: overview.events, sub: null },
        { label: 'Certificates', value: overview.certificates, sub: `${overview.certs30d} in 30 days` },
        { label: 'Active', value: overview.activeCertificates, sub: `${overview.revokedCertificates} revoked` },
        { label: 'Verification views', value: overview.totalViews, sub: null },
        { label: 'Templates', value: overview.templates, sub: `${overview.batches} batch runs` },
      ]
    : [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200/80 bg-[#FBFAF5]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-6 h-6 text-primary-600" />
            <div>
              <h1 className="font-jura font-bold text-lg text-stone-900 leading-tight">Admin console</h1>
              <p className="text-[11px] text-stone-500 font-quicksand">
                Aggregate analytics &amp; access management — user data stays with users.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadAll()}
              className="p-2 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
              title="Refresh"
              aria-label="Refresh"
            >
              <RefreshCw className="w-4 h-4 text-stone-500" />
            </button>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="px-3 py-1.5 text-xs font-semibold text-stone-600 border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors cursor-pointer"
            >
              Back to app
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-1 pb-px">
          {(
            [
              { id: 'overview' as const, label: 'Overview', Icon: BarChart3 },
              { id: 'access' as const, label: 'Access management', Icon: KeyRound },
            ]
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-t-lg border border-b-0 transition-colors cursor-pointer ${
                tab === id
                  ? 'bg-white border-stone-200 text-stone-900 -mb-px'
                  : 'text-stone-500 hover:text-stone-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {tab === 'overview' && (
          <div className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {tiles.map((t) => (
                <div key={t.label} className="py-3 px-4 rounded-xl border border-[#E5DAC3] bg-white/70">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 font-quicksand">
                    {t.label}
                  </p>
                  <p className="font-saira font-bold text-2xl text-slate-900 tabular-nums mt-0.5">
                    {t.value.toLocaleString()}
                  </p>
                  {t.sub && <p className="text-[11px] text-stone-400 font-quicksand">{t.sub}</p>}
                </div>
              ))}
            </div>

            <div>
              <h2 className="font-jura font-bold text-base text-stone-900 mb-2 flex items-center gap-1.5">
                <LayoutDashboard className="w-4 h-4 text-stone-400" />
                Per-account activity
              </h2>
              <p className="text-xs text-stone-500 font-quicksand mb-2">
                Counts and dates only — certificate contents and recipient data are never visible to admins.
              </p>
              <div className="overflow-x-auto rounded-xl border border-[#E5DAC3] bg-white/70">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 border-b border-[#E5DAC3]">
                      <th className="px-3 py-2 font-quicksand">Account</th>
                      <th className="px-3 py-2 font-quicksand">Role</th>
                      <th className="px-3 py-2 font-quicksand text-right">Events</th>
                      <th className="px-3 py-2 font-quicksand text-right">Certs</th>
                      <th className="px-3 py-2 font-quicksand text-right">Active</th>
                      <th className="px-3 py-2 font-quicksand text-right">Revoked</th>
                      <th className="px-3 py-2 font-quicksand text-right">Views</th>
                      <th className="px-3 py-2 font-quicksand">Joined</th>
                      <th className="px-3 py-2 font-quicksand">Last active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 font-quicksand text-slate-700">
                    {accounts.map((a) => (
                      <tr key={a.email}>
                        <td className="px-3 py-2 font-medium break-all">{a.email}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                              a.role === 'super_admin'
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                : a.role === 'admin'
                                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                                  : 'bg-slate-50 text-slate-500 border-slate-200'
                            }`}
                          >
                            {a.role}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{a.eventCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{a.certificateCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{a.activeCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-red-600">{a.revokedCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Eye className="w-3 h-3 text-stone-300" />
                            {a.totalViews.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-stone-500">{a.createdAt ?? '—'}</td>
                        <td className="px-3 py-2 text-stone-500">{a.lastActiveAt ?? '—'}</td>
                      </tr>
                    ))}
                    {accounts.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-6 text-center text-stone-400">
                          No accounts yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'access' && (
          <div className="space-y-5 animate-fade-in max-w-3xl">
            <div className="p-4 rounded-xl border border-[#E5DAC3] bg-white/70 space-y-3">
              <h2 className="font-jura font-bold text-base text-stone-900 flex items-center gap-1.5">
                <UserPlus className="w-4 h-4 text-stone-400" />
                Grant platform access
              </h2>
              <p className="text-xs text-stone-500 font-quicksand">
                Only emails on this list can sign in.
                {callerRole === 'super_admin'
                  ? ' As super admin you can also elevate other admins.'
                  : ' Only the super admin can add more admins.'}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="name@organization.com"
                  type="email"
                  className="flex-1 px-3 py-2 text-sm bg-white border border-[#E5DAC3] rounded-lg focus:outline-none focus:border-slate-400 font-quicksand"
                  aria-label="Email to grant access"
                />
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as 'user' | 'admin')}
                  className="px-3 py-2 text-sm bg-white border border-[#E5DAC3] rounded-lg focus:outline-none focus:border-slate-400 font-quicksand cursor-pointer"
                  aria-label="Role"
                >
                  <option value="user">User</option>
                  {callerRole === 'super_admin' && <option value="admin">Admin</option>}
                </select>
                <button
                  type="button"
                  onClick={() => void saveAccess()}
                  disabled={saving || !newEmail.trim()}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                >
                  Grant access
                </button>
              </div>
              {message && (
                <p className={`text-xs font-quicksand font-medium ${message.ok ? 'text-emerald-700' : 'text-red-600'}`} role="status">
                  {message.text}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-[#E5DAC3] bg-white/70 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 border-b border-[#E5DAC3]">
                    <th className="px-4 py-2 font-quicksand">Email</th>
                    <th className="px-4 py-2 font-quicksand">Role</th>
                    <th className="px-4 py-2 font-quicksand">Added</th>
                    <th className="px-4 py-2 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 font-quicksand text-slate-700">
                  {access.map((a) => (
                    <tr key={a.email}>
                      <td className="px-4 py-2 font-medium break-all">{a.email}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            a.role === 'super_admin'
                              ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                              : a.role === 'admin'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}
                        >
                          {a.role}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-stone-500">
                        {new Date(a.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {a.role !== 'super_admin' && (
                          <button
                            type="button"
                            onClick={() => void removeAccess(a.email)}
                            disabled={saving}
                            className="p-1.5 text-stone-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            title="Revoke access"
                            aria-label={`Revoke access for ${a.email}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function AdminPage() {
  return <AdminClient />;
}
