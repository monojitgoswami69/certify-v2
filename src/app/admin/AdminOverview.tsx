const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

export interface Overview {
  accounts: number;
  newAccounts30d: number;
  events: number;
  certificates: number;
  activeCertificates: number;
  revokedCertificates: number;
  totalViews: number;
  templates: number;
  batches: number;
  certs30d: number;
}

export interface AccountRow {
  email: string;
  role: string;
  createdAt: string | null;
  eventCount: number;
  certificateCount: number;
  activeCount: number;
  revokedCount: number;
  totalViews: number;
  lastActiveAt: string | null;
}

export function AdminOverview({ overview, accounts }: { overview: Overview | null; accounts: AccountRow[] | null }) {
  const metrics = overview ? [
    { label: 'Accounts', value: overview.accounts, detail: `${overview.newAccounts30d.toLocaleString()} joined in 30 days` },
    { label: 'Events', value: overview.events },
    { label: 'Certificates', value: overview.certificates, detail: `${overview.certs30d.toLocaleString()} issued in 30 days` },
    { label: 'Active certificates', value: overview.activeCertificates, detail: `${overview.revokedCertificates.toLocaleString()} revoked` },
    { label: 'Verification views', value: overview.totalViews },
    { label: 'Templates', value: overview.templates, detail: `${overview.batches.toLocaleString()} batch runs` },
  ] : [];

  return (
    <div className="space-y-7">
      {overview && (
        <section aria-labelledby="platform-activity">
          <h2 id="platform-activity" className="section-title">Platform activity</h2>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-6">
            {metrics.map(({ label, value, detail }) => (
              <div key={label} className="min-w-0 border-t border-app-border pt-3">
                <dt className="text-sm leading-snug font-medium text-stone-700">{label}</dt>
                <dd className="page-title mt-1 tabular-nums [overflow-wrap:anywhere]">{value.toLocaleString()}</dd>
                {detail && <dd className="mt-1 text-xs leading-snug text-stone-700">{detail}</dd>}
              </div>
            ))}
          </dl>
        </section>
      )}

      {accounts && (
        <section aria-labelledby="account-activity">
          <h2 id="account-activity" className="section-title">Account activity</h2>
          {accounts.length === 0 ? (
            <p className="mt-3 text-stone-700">No account activity yet.</p>
          ) : (
            <div tabIndex={0} role="region" aria-labelledby="account-activity" className="mt-4 overflow-x-auto rounded-sm focus-visible:outline-2 focus-visible:outline-primary-600">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="border-y border-app-border bg-app-header text-stone-800">
                  <tr>
                    <th scope="col" className="px-3 py-3 font-semibold">Account</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Role</th>
                    {['Events', 'Certificates', 'Active', 'Revoked', 'Views'].map((label) => (
                      <th key={label} scope="col" className="px-3 py-3 text-right font-semibold">{label}</th>
                    ))}
                    <th scope="col" className="px-3 py-3 font-semibold">Joined</th>
                    <th scope="col" className="px-3 py-3 whitespace-nowrap font-semibold">Last active</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app-border border-b border-app-border">
                  {accounts.map((account) => (
                    <tr key={account.email}>
                      <th scope="row" className="min-w-44 px-3 py-4 text-left font-semibold [overflow-wrap:anywhere]">{account.email}</th>
                      <td className="px-3 py-4 whitespace-nowrap text-stone-700">
                        {account.role === 'super_admin' ? 'Super admin' : account.role === 'admin' ? 'Admin' : account.role === 'revoked' ? 'Revoked' : 'User'}
                      </td>
                      {[account.eventCount, account.certificateCount, account.activeCount, account.revokedCount, account.totalViews].map((value, index) => (
                        <td key={index} className="px-3 py-4 text-right tabular-nums">{value.toLocaleString()}</td>
                      ))}
                      <td className="px-3 py-4 whitespace-nowrap text-stone-700">
                        {account.createdAt ? <time dateTime={account.createdAt}>{dateFormat.format(new Date(account.createdAt))}</time> : '—'}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-stone-700">
                        {account.lastActiveAt ? <time dateTime={account.lastActiveAt}>{dateFormat.format(new Date(account.lastActiveAt))}</time> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
