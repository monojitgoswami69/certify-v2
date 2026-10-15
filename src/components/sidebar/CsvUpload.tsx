'use client';

import { useCallback } from 'react';
import { FileText } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { parseCsv } from '../../lib/csv-parser';

const MAX_CSV_BYTES = 20 * 1024 * 1024;

export function CsvUpload() {
  const { setCsvData, setError } = useAppStore();

  const handleFile = useCallback(
    (file: File) => {
      if (!file) return;
      if (!/\.(csv|txt)$/i.test(file.name) && file.type && !/csv|text\/plain/.test(file.type)) {
        setError('Please upload a .csv file.');
        return;
      }
      if (file.size > MAX_CSV_BYTES) {
        setError('CSV file is too large (max 20 MB).');
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => setError('Could not read the CSV file.');
      reader.onload = (e) => {
        try {
          const bytes = new Uint8Array(e.target?.result as ArrayBuffer);
          const isUtf16Le = bytes[0] === 0xff && bytes[1] === 0xfe;
          const isUtf16Be = bytes[0] === 0xfe && bytes[1] === 0xff;
          const text = new TextDecoder(isUtf16Le ? 'utf-16le' : isUtf16Be ? 'utf-16be' : 'utf-8').decode(bytes);
          const { headers, data } = parseCsv(text);
          setCsvData(file, headers, data);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to parse CSV');
        }
      };
      reader.readAsArrayBuffer(file);
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
