'use client';

import { useState } from 'react';
import { UserPlus, Loader2, Check } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

/**
 * Console single-recipient add: append one person to the loaded roster
 * without a CSV round-trip. Appends to the existing headers (or seeds
 * Name/Email headers on a fresh workspace).
 */
export function AddRecipientForm() {
  const { csvData, csvHeaders, csvFile, setCsvData } = useAppStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailHeader = csvHeaders.find((h) => h.toLowerCase().includes('email')) ?? null;

  const submit = async () => {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (emailHeader && email.trim() && !email.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Small await keeps the button feedback honest for rapid re-adds.
      await Promise.resolve();
      const headers = csvHeaders.length > 0 ? [...csvHeaders] : ['Name', 'Email'];
      if (headers.every((h) => h.toLowerCase() !== 'name')) headers.unshift('Name');
      const effectiveEmailHeader = headers.find((h) => h.toLowerCase().includes('email')) ?? null;
      if (email.trim() && !effectiveEmailHeader) {
        headers.push('Email');
      }

      const row: Record<string, string> = {};
      for (const h of headers) row[h] = '';
      row['Name'] = name.trim();
      if (email.trim() && headers.find((h) => h.toLowerCase().includes('email'))) {
        row[headers.find((h) => h.toLowerCase().includes('email'))!] = email.trim();
      }

      const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const allRows = [...csvData, row];
      const csvContent = [
        headers.map(esc).join(','),
        ...allRows.map((r) => headers.map((h) => esc(r[h] ?? '')).join(',')),
      ].join('\n');
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const file = new File([blob], csvFile?.name || 'roster.csv', { type: 'text/csv' });

      setCsvData(file, headers, allRows);
      setName('');
      setEmail('');
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add recipient');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pt-3 mt-1 border-t border-slate-200/80">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <UserPlus className="w-3.5 h-3.5" />
        Add single recipient
      </p>
      <div className="flex gap-1.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !saving && void submit()}
          placeholder="Full name"
          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 font-quicksand"
          aria-label="Recipient name"
        />
        {emailHeader && (
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !saving && void submit()}
            placeholder="Email"
            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-slate-400 font-quicksand"
            aria-label="Recipient email"
          />
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || !name.trim()}
          className="shrink-0 inline-flex items-center justify-center px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Add recipient"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : added ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <UserPlus className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
