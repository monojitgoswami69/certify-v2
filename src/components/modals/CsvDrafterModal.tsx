'use client';

import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Table2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { parseCsv } from '../../lib/csv-parser';

const MAX_ROWS = 2000;
const MAX_COLS = 40;

/**
 * Draft-a-CSV: an Excel-like grid to define a roster from scratch — first row
 * is the header set, every row below is a recipient. Replaces the workspace's
 * CSV data on save, exactly like an uploaded file would.
 */
export function CsvDrafterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { csvData, csvHeaders, setCsvData, csvFile } = useAppStore();
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Seed from the workspace when present; otherwise a sensible starter.
    if (csvHeaders.length > 0) {
      setHeaders([...csvHeaders]);
      setRows(csvData.slice(0, MAX_ROWS).map((r) => csvHeaders.map((h) => r[h] ?? '')));
    } else {
      setHeaders(['Name', 'Email']);
      setRows([['', '']]);
    }
    setError(null);
  }, [open, csvHeaders, csvData]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const setCell = (r: number, c: number, value: string) =>
    setRows((prev) => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row)));

  const addRow = () => rows.length < MAX_ROWS && setRows((prev) => [...prev, headers.map(() => '')]);
  const removeRow = (r: number) => setRows((prev) => prev.filter((_, i) => i !== r));
  const addColumn = () =>
    headers.length < MAX_COLS && setHeaders((prev) => [...prev, `Column ${prev.length + 1}`]);
  const removeColumn = (c: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== c));
    setRows((prev) => prev.map((row) => row.filter((_, i) => i !== c)));
  };
  const renameColumn = (c: number, value: string) =>
    setHeaders((prev) => prev.map((h, i) => (i === c ? value : h)));

  const save = () => {
    const cleanHeaders = headers.map((h) => h.trim());
    if (!cleanHeaders.some(Boolean)) {
      setError('Add at least one named column.');
      return;
    }
    if (!rows.some((row) => row.some((cell) => cell.trim() !== ''))) {
      setError('Add at least one recipient row.');
      return;
    }
    // Synthesize a CSV file so downloads/display behave like a real upload.
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csvContent = [
      cleanHeaders.map(esc).join(','),
      ...rows.map((row) => cleanHeaders.map((_, i) => esc((row[i] ?? '').trim())).join(',')),
    ].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const file = new File([blob], 'draft-roster.csv', { type: 'text/csv' });

    const parsed = parseCsv(csvContent);
    setCsvData(file, parsed.headers, parsed.data, parsed.review);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-stone-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Draft CSV"
    >
      <div
        className="bg-[#FBFAF5] rounded-2xl border border-stone-200 shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200/80">
          <div className="flex items-center gap-2.5">
            <Table2 className="w-5 h-5 text-primary-600" />
            <div>
              <h2 className="font-semibold text-lg text-stone-900">Draft your roster</h2>
              <p className="text-xs text-stone-500">
                First row is the header set — e.g. Name, Email, Course. Every row below is one recipient.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
            aria-label="Close CSV drafter"
          >
            <X className="w-5 h-5 text-stone-500" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="w-8" />
                {headers.map((h, c) => (
                  <th key={c} className="p-1 min-w-[140px]">
                    <div className="flex items-center gap-1">
                      <input
                        value={h}
                        onChange={(e) => renameColumn(c, e.target.value)}
                        className="flex-1 px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-700 bg-slate-100 border border-stone-200 rounded-md focus:outline-none focus:border-slate-400"
                        aria-label={`Column ${c + 1} header`}
                      />
                      <button
                        type="button"
                        onClick={() => removeColumn(c)}
                        className="p-1 text-stone-300 hover:text-red-500 transition-colors cursor-pointer"
                        aria-label={`Remove column ${h}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </th>
                ))}
                <th className="w-10">
                  <button
                    type="button"
                    onClick={addColumn}
                    className="p-1.5 text-stone-400 hover:text-primary-600 transition-colors cursor-pointer"
                    aria-label="Add column"
                    title="Add column"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} className="group">
                  <td className="text-[10px] font-mono text-stone-300 text-right pr-1 select-none">
                    {r + 1}
                  </td>
                  {headers.map((_, c) => (
                    <td key={c} className="p-0.5">
                      <input
                        value={row[c] ?? ''}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        className="w-full px-2 py-1.5 text-xs bg-white border border-stone-200 rounded-md focus:outline-none focus:border-primary-400"
                        aria-label={`Row ${r + 1} ${headers[c]}`}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      onClick={() => removeRow(r)}
                      className="p-1 text-stone-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      aria-label={`Remove row ${r + 1}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={addRow}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-stone-600 border border-dashed border-stone-300 rounded-lg hover:border-stone-500 hover:bg-stone-50 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add recipient row
          </button>
        </div>

        <div className="px-5 py-3.5 border-t border-stone-200/80 flex items-center justify-between gap-3">
          <p className="text-[11px] text-red-600 font-medium">{error}</p>
          <button
            type="button"
            onClick={save}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer"
          >
            Use this roster ({rows.filter((r) => r.some((c) => c.trim() !== '')).length} recipients)
          </button>
        </div>
      </div>
    </div>
  );
}
