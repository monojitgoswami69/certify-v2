'use client';

import { useCallback } from 'react';
import { FileText } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { readCsvFile } from '../../lib/csv-parser';

export function CsvUpload() {
  const { setCsvData, setError } = useAppStore();

  const handleFile = useCallback(
    async (file: File) => {
      if (!file) return;
      if (!/\.(csv|txt)$/i.test(file.name) && file.type && !/csv|text\/plain/.test(file.type)) {
        setError('Please upload a .csv file.');
        return;
      }
      try {
        const { headers, data, review } = await readCsvFile(file);
        setCsvData(file, headers, data, review);
        setError(data.length ? null : `The CSV has ${review.ignored.length} empty records and no recipients.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read CSV');
      }
    },
    [setCsvData, setError]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = '';
    },
    [handleFile]
  );

  return (
    <label
      className="flex items-center gap-3 p-4 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input type="file" accept=".csv" className="hidden" onChange={handleChange} />
      <FileText className="w-6 h-6 text-slate-400" />
      <span className="text-sm text-slate-600">Upload CSV file</span>
    </label>
  );
}
