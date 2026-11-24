'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import type { ManagedRole, PlatformRole } from '../../lib/platform-access';
import { MAX_MAILS_PER_MINUTE, MAX_MAILS_PER_SECOND, type MailLimits } from '../../lib/mail-limits';

export interface AccessRow extends MailLimits {
  email: string;
  role: PlatformRole;
  canIssueCertificates: boolean;
  createdAt: string;
}

type AccountAction = { account: AccessRow; kind: 'limits' | 'revoke' };

interface AccessManagementProps {
  access: AccessRow[];
  callerRole: 'admin' | 'super_admin';
  busy: boolean;
  error: string | null;
  onOpenAction: () => void;
  onGrant: (email: string, role: ManagedRole) => Promise<boolean>;
  onIssue: (email: string, canIssueCertificates: boolean) => Promise<boolean>;
  onLimits: (email: string, limits: MailLimits) => Promise<boolean>;
  onRevoke: (email: string) => Promise<boolean>;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const fieldClass = 'form-control-text min-h-11 min-w-0 rounded-md border border-stone-400 bg-white px-3 font-normal text-slate-900 placeholder:text-stone-600 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-600 sm:min-h-9';
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60 sm:min-h-9';

export function AccessManagement({
  access, callerRole, busy, error, onOpenAction, onGrant, onIssue, onLimits, onRevoke,
}: AccessManagementProps) {
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState<ManagedRole | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<AccountAction | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const isSuperAdmin = callerRole === 'super_admin';
  const existing = access.find((account) => account.email === email.trim().toLowerCase());
  const role = isSuperAdmin ? selectedRole ?? (existing?.role === 'admin' ? 'admin' : 'user') : 'user';
  const canGrant = !busy && Boolean(email.trim()) && existing?.role !== 'super_admin' &&
    (isSuperAdmin || existing?.role !== 'admin');
  const visible = access.filter((account) => account.email.includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (action && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [action]);

  function openAction(account: AccessRow, kind: AccountAction['kind']) {
    onOpenAction();
    setAction({ account, kind });
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="grant-access-heading">
        <h2 id="grant-access-heading" className="section-title">Grant sign-in access</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-stone-700">
          Add someone by their Google email address. Enable certificate issuance separately on their account below.
        </p>
        <form
          className="mt-4 grid max-w-3xl items-end gap-3 sm:flex sm:flex-wrap"
          onSubmit={async (event) => {
            event.preventDefault();
            const normalizedEmail = email.trim().toLowerCase();
            if (await onGrant(normalizedEmail, role)) {
              setEmail('');
              setSelectedRole(null);
              setSearch('');
            }
          }}
        >
          <label className="grid min-w-0 gap-1.5 text-sm font-semibold sm:flex-[1_1_16rem]">
            Google email
            <input className={fieldClass} type="email" autoComplete="off" required maxLength={254} disabled={busy}
              placeholder="name@example.com" value={email}
              onChange={(event) => {
                const nextEmail = event.target.value;
                if (existing || access.some((account) => account.email === nextEmail.trim().toLowerCase())) {
                  setSelectedRole(null);
                }
                setEmail(nextEmail);
              }} />
          </label>
          {isSuperAdmin && (
            <label className="grid gap-1.5 text-sm font-semibold sm:min-w-36">
              Role
              <select value={role} className={fieldClass} disabled={busy || existing?.role === 'super_admin'}
                onChange={(event) => setSelectedRole(event.target.value as ManagedRole)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          )}
          <button type="submit" disabled={!canGrant}
            className={`${buttonClass} bg-primary-600 text-white enabled:hover:bg-primary-700 disabled:bg-primary-100 disabled:text-primary-800 disabled:opacity-100`}>
            <UserPlus className="size-4" aria-hidden="true" />
            {existing ? 'Update access' : 'Grant access'}
          </button>
        </form>
      </section>

      <section aria-labelledby="allowed-accounts-heading" className="border-t border-app-border pt-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h2 id="allowed-accounts-heading" className="section-title">Allowed accounts</h2>
            <p className="mt-1 text-xs text-stone-700">
              {search.trim() ? `${visible.length} of ${access.length}` : access.length} {access.length === 1 ? 'account' : 'accounts'}
            </p>
          </div>
          <label className="grid w-full gap-1.5 text-sm font-semibold sm:w-72">
            Find an account
            <span className="relative block">
              <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-stone-700" aria-hidden="true" />
              <input type="search" placeholder="Search by email" value={search} onChange={(event) => setSearch(event.target.value)}
                className={`${fieldClass} w-full pl-9`} />
            </span>
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="mt-4 border-t border-app-border py-5 text-stone-700">
            {search.trim() ? 'No accounts match that email.' : 'No accounts have sign-in access yet.'}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-app-border border-y border-app-border">
            {visible.map((account) => {
              const canManageAccount = isSuperAdmin || account.role === 'user';
              const roleLabel = account.role === 'super_admin' ? 'Super admin' : account.role === 'admin' ? 'Admin' : 'User';

              return (
                <li key={account.email} className="grid grid-cols-2 items-start gap-x-3 gap-y-3 py-3.5 sm:gap-x-5 lg:grid-cols-[minmax(0,2.2fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_13rem] lg:items-center">
                  <div className="col-span-2 min-w-0 lg:col-span-1">
                    <p className="text-sm font-semibold [overflow-wrap:anywhere]">{account.email}</p>
                    <p className="mt-1 text-xs leading-relaxed text-stone-700">
                      {roleLabel}<span aria-hidden="true"> · </span>
                      Added <time dateTime={account.createdAt}>{dateFormat.format(new Date(account.createdAt))}</time>
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-stone-700">Issuance</p>
                    {canManageAccount ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={account.canIssueCertificates}
                        aria-label={`Certificate issuance for ${account.email}`}
                        disabled={busy}
                        onClick={() => void onIssue(account.email, !account.canIssueCertificates)}
                        className="inline-flex min-h-10 items-center gap-2 rounded-sm text-sm font-medium text-slate-900 enabled:hover:text-primary-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60 sm:min-h-8"
                      >
                        <span aria-hidden="true" className={`relative h-5 w-9 shrink-0 rounded-full ${account.canIssueCertificates ? 'bg-primary-600' : 'bg-stone-500'}`}>
                          <span className={`absolute top-0.5 size-4 rounded-full bg-white ${account.canIssueCertificates ? 'right-0.5' : 'left-0.5'}`} />
                        </span>
                        {account.canIssueCertificates ? 'Enabled' : 'Disabled'}
                      </button>
                    ) : <p className="flex min-h-10 items-center text-sm font-medium sm:min-h-8">{account.canIssueCertificates ? 'Enabled' : 'Disabled'}</p>}
                  </div>

                  <div>
                    <p className="text-xs font-medium text-stone-700">Sending limits</p>
                    <p className="flex min-h-10 items-center text-sm font-medium tabular-nums sm:min-h-8">
                      {account.mailsPerMinute}/min · {account.mailsPerSecond}/sec
                    </p>
                  </div>

                  <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 lg:col-span-1 lg:grid lg:grid-cols-[5rem_1fr] lg:justify-items-end">
                    {isSuperAdmin && (
                      <button type="button" disabled={busy} onClick={() => openAction(account, 'limits')}
                        aria-label={`Edit sending limits for ${account.email}`}
                        className="min-h-10 rounded-sm text-sm font-semibold text-primary-800 enabled:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-60">
                        Edit limits
                      </button>
                    )}
                    {canManageAccount && account.role !== 'super_admin' && (
                      <button type="button" disabled={busy} onClick={() => openAction(account, 'revoke')}
                        aria-label={`Revoke sign-in for ${account.email}`}
                        className="min-h-10 rounded-sm text-sm font-semibold whitespace-nowrap text-red-800 enabled:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:opacity-60 lg:col-start-2">
                        Revoke sign-in
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {action && (
        <dialog
          ref={dialogRef}
          aria-labelledby="account-action-title"
          aria-describedby="account-action-description"
          onClose={() => setAction(null)}
          onCancel={(event) => { if (busy) event.preventDefault(); }}
          className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-app-border bg-app-background p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/40 sm:p-6"
        >
          <h2 id="account-action-title" className="section-title">
            {action.kind === 'limits' ? 'Edit sending limits' : 'Revoke sign-in access'}
          </h2>
          <p id="account-action-description" className="mt-2 text-sm leading-relaxed text-stone-700 [overflow-wrap:anywhere]">
            <strong className="font-semibold text-slate-900">{action.account.email}</strong>
            {action.kind === 'revoke' && ' will be signed out of Certify on all devices.'}
          </p>
          <form
            className="mt-5"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const saved = action.kind === 'limits'
                ? await onLimits(action.account.email, {
                    mailsPerMinute: Number(form.get('minute')),
                    mailsPerSecond: Number(form.get('second')),
                  })
                : await onRevoke(action.account.email);
              if (saved) dialogRef.current?.close();
            }}
          >
            {action.kind === 'limits' && (
              <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold">
                  Emails per minute
                  <input name="minute" type="number" min={1} max={MAX_MAILS_PER_MINUTE} required autoFocus
                    defaultValue={action.account.mailsPerMinute} className={fieldClass} />
                </label>
                <label className="grid gap-1.5 text-sm font-semibold">
                  Emails per second
                  <input name="second" type="number" min={1} max={MAX_MAILS_PER_SECOND} required
                    defaultValue={action.account.mailsPerSecond} className={fieldClass} />
                </label>
              </fieldset>
            )}
            {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" disabled={busy} autoFocus={action.kind === 'revoke'} onClick={() => dialogRef.current?.close()}
                className={`${buttonClass} text-stone-800 enabled:hover:bg-app-header`}>
                Cancel
              </button>
              <button type="submit" disabled={busy}
                className={`${buttonClass} text-white ${action.kind === 'limits' ? 'bg-primary-600 enabled:hover:bg-primary-700' : 'bg-red-700 enabled:hover:bg-red-800'}`}>
                {busy ? 'Saving…' : action.kind === 'limits' ? 'Save limits' : 'Revoke sign-in'}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </div>
  );
}
