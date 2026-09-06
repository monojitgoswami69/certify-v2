'use client';

import { useState, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Table, Search } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

interface CsvPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CsvPreviewModal({ isOpen, onClose }: CsvPreviewModalProps) {
  const { csvHeaders, csvData, csvFile } = useAppStore();
  const [mounted, setMounted] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return csvData;
    return csvData.filter((row) =>
      Object.values(row).some((val) =>
        String(val || '').toLowerCase().includes(q)
      )
    );
  }, [csvData, searchQuery]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200/80">
        {/* Fixed Modal Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
              <Table className="w-4 h-4 text-primary-600" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-slate-900 text-base tracking-tight truncate">
                CSV Data Preview
              </h2>
              <p className="text-xs text-slate-500 truncate mt-0.5">
                <span className="font-medium text-slate-700">{csvFile?.name || 'Uploaded Dataset'}</span>
                {' · '}
                <span>{csvData.length} records</span>
                {' · '}
                <span>{csvHeaders.length} columns</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Quick Filter Search */}
            <div className="relative hidden sm:block w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter preview rows..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white text-xs border border-slate-200 rounded-lg outline-none focus:outline-none focus:ring-0 focus:border-slate-400 transition-all text-slate-800 placeholder-slate-400"
              />
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Close Preview"
              aria-label="Close Preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Mobile Search input when screen is small */}
        <div className="sm:hidden px-4 py-2 border-b border-slate-200 bg-slate-50">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter preview rows..."
              className="w-full pl-8 pr-3 py-1.5 bg-white text-xs border border-slate-200 rounded-lg outline-none focus:border-primary-500 text-slate-800"
            />
          </div>
        </div>

        {/* Scrollable Table Viewport with both vertical and horizontal scroll */}
        <div className="flex-1 overflow-auto bg-slate-50/50 relative">
          <table className="w-max min-w-full text-xs text-left border-collapse">
            {/* Fixed Sticky Table Header */}
            <thead className="sticky top-0 z-20 shadow-2xs">
              <tr className="bg-slate-100/95 backdrop-blur-xs border-b border-slate-200 text-slate-700">
                {/* Fixed Top-Left Corner Header for row index */}
                <th className="sticky left-0 top-0 z-30 bg-slate-200/95 backdrop-blur-xs px-3.5 py-2.5 font-bold uppercase tracking-wider text-[11px] text-slate-600 border-r border-b border-slate-300 text-center w-12 select-none">
                  #
                </th>
                {csvHeaders.map((header, idx) => (
                  <th
                    key={idx}
                    className="px-4 py-2.5 font-bold uppercase tracking-wider text-[11px] text-slate-700 whitespace-nowrap border-b border-slate-200"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>

            {/* Scrollable Rows */}
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={csvHeaders.length + 1}
                    className="py-12 text-center text-slate-400 text-sm font-medium"
                  >
                    No matching records found for "{searchQuery}"
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, rowIdx) => (
                  <tr
                    key={rowIdx}
                    className="hover:bg-primary-50/30 transition-colors group"
                  >
                    {/* Fixed Sticky Left Column for row number */}
                    <td className="sticky left-0 z-10 bg-slate-50/95 group-hover:bg-slate-100/95 backdrop-blur-xs px-3.5 py-2 text-center text-slate-400 font-mono text-[11px] border-r border-slate-200 whitespace-nowrap font-medium select-none">
                      {rowIdx + 1}
                    </td>
                    {csvHeaders.map((header, colIdx) => (
                      <td
                        key={colIdx}
                        className="px-4 py-2 text-slate-700 whitespace-nowrap font-normal"
                        title={row[header]}
                      >
                        {row[header] !== undefined && row[header] !== '' ? (
                          <span>{row[header]}</span>
                        ) : (
                          <span className="text-slate-300 italic text-[11px]">empty</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Fixed Footer Bar */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-2.5 border-t border-slate-200 bg-slate-50 shrink-0 text-xs text-slate-500">
          <div>
            Showing <span className="font-semibold text-slate-800">{filteredRows.length}</span> of{' '}
            <span className="font-semibold text-slate-800">{csvData.length}</span> rows
            {searchQuery && ' (filtered)'}
          </div>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
