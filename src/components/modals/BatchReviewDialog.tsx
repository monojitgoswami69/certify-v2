'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { inspectBatchLayout, rankReviewRecords, relatedRecords, type ReviewRecord } from '../../lib/batch-review';
import type { CsvReviewMetadata } from '../../lib/csv-parser';
import type { EventLayout } from '../../lib/event-design';

const PAGE_SIZE = 25;

interface BatchReviewDialogProps {
  title: string;
  records: ReviewRecord[];
  cleaning: CsvReviewMetadata;
  template: HTMLImageElement;
  layout: EventLayout;
  onClose: () => void;
  onIssue: (selected: Set<number>) => Promise<void>;
}

export function BatchReviewDialog({ title, records, cleaning, template, layout, onClose, onIssue }: BatchReviewDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const busyRef = useRef(false);
  const [issuing, setIssuing] = useState(false);
  const [scan, setScan] = useState<Awaited<ReturnType<typeof inspectBatchLayout>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [omitted, setOmitted] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'attention' | 'all' | 'removed'>('attention');
  const [page, setPage] = useState(0);
  const [sample, setSample] = useState<ReviewRecord | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState(false);

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void inspectBatchLayout(records, layout.boxes, template.naturalWidth || template.width,
      template.naturalHeight || template.height, controller.signal).then((value) => {
      if (!controller.signal.aborted) setScan(value);
    }).catch((reason) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not check the certificate layout.');
    });
    return () => controller.abort();
  }, [records, layout, template]);

  useEffect(() => {
    if (!sample) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    void import('../../lib/certificate-engine').then(({ generateCertificate }) => generateCertificate({
      templateImage: template, boxes: layout.boxes, row: sample.row, filename: 'certificate-preview',
      includePng: true, qrZones: layout.qrZones, images: layout.images, sampleQr: true,
    })).then(({ pngBlob }) => {
      if (!cancelled && pngBlob) {
        objectUrl = URL.createObjectURL(pngBlob);
        setSampleUrl(objectUrl);
      }
    }).catch(() => { if (!cancelled) setSampleError(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [layout, sample, template]);

  const related = useMemo(() => relatedRecords(records), [records]);
  const attention = useMemo(() => rankReviewRecords(records.filter((record) => record.blocked || record.note
    || related.notes.has(record.number) || scan?.result.has(record.number)), scan?.result ?? new Map()), [records, related, scan]);
  const selected = useMemo(() => new Set(records.filter(({ number, blocked }) => !blocked && !omitted.has(number))
    .map(({ number }) => number)), [records, omitted]);
  const unresolved = related.conflicts.some((group) => group.filter((number) => selected.has(number)).length > 1);
  const emptyCount = cleaning.ignored.filter(({ duplicateOf }) => duplicateOf === undefined).length;
  const recordList = filter === 'all' ? records : attention;
  const total = filter === 'removed' ? cleaning.ignored.length : recordList.length;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
  const pageStart = currentPage * PAGE_SIZE;

  function viewSample(record: ReviewRecord) {
    if (sample === record) return;
    setSampleUrl(null);
    setSampleError(false);
    setSample(record);
  }

  async function issue() {
    if (busyRef.current || !scan || unresolved || !selected.size) return;
    busyRef.current = true;
    setIssuing(true);
    setError(null);
    try {
      await onIssue(selected);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The certificates could not be issued.');
    } finally {
      busyRef.current = false;
      setIssuing(false);
    }
  }

  return (
    <dialog ref={dialog} aria-label={title} onCancel={(event) => { event.preventDefault(); if (!issuing) onClose(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[min(56rem,calc(100%-2rem))] rounded-xl p-0 text-slate-900 shadow-xl backdrop:bg-stone-950/60">
      <div className="flex max-h-[90dvh] flex-col bg-white">
        <header className="flex items-start justify-between border-b border-stone-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-stone-600">{selected.size} selected · {emptyCount} empty removed · {cleaning.ignored.length - emptyCount} exact duplicates removed</p>
          </div>
          <button type="button" aria-label="Close batch review" disabled={issuing} onClick={onClose} className="p-2 hover:text-primary-700"><X className="h-5 w-5" /></button>
        </header>
        <div className="overflow-y-auto px-5 py-4">
          {!scan && !error && <p role="status" className="mb-3 text-sm text-stone-600">Checking printed fields and text fit…</p>}
          {scan?.fallbackFonts.length ? <p className="mb-3 text-sm text-amber-800">Could not load {scan.fallbackFonts.join(', ')}. The preview and fit check use available fonts.</p> : null}
          {cleaning.renamedHeaders?.length ? <p className="mb-3 text-sm text-amber-800">Review renamed CSV headers. {cleaning.renamedHeaders.map(({ column, header, name }) =>
            `Column ${column} (${name || 'blank'}) is mapped as “${header}”.`).join(' ')}</p> : null}
          {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 pb-3 text-sm">
            {(['attention', 'all', 'removed'] as const).map((option) => (
              <button type="button" key={option} aria-pressed={filter === option} onClick={() => { setFilter(option); setPage(0); }}
                className={filter === option ? 'font-semibold text-slate-900 underline underline-offset-4' : 'text-stone-600 hover:text-slate-900'}>
                {option === 'attention' ? `Needs review (${attention.length})` : option === 'all' ? `All records (${records.length})` : `Removed (${cleaning.ignored.length})`}
              </button>
            ))}
            {scan && records.length > 0 && <button type="button" className="ml-auto font-semibold text-primary-700 underline" onClick={() => viewSample(records[0])}>Preview first certificate</button>}
          </div>
          {sample && <figure className="space-y-2 border-b border-stone-200 py-3">
            <figcaption className="flex items-center justify-between text-sm font-medium">
              <span>Record {sample.number} · {sample.name}{layout.qrZones?.length ? ' · Sample QR' : ''}</span>
              <button type="button" className="text-xs font-semibold underline" onClick={() => { setSample(null); setSampleUrl(null); }}>Close preview</button>
            </figcaption>
            {sampleUrl ? <img src={sampleUrl} className="max-h-[40vh] max-w-full object-contain" alt={`Certificate preview for record ${sample.number}`} />
              : <p role="status" className="text-sm text-stone-600">{sampleError ? 'Preview unavailable.' : 'Rendering preview…'}</p>}
          </figure>}
          {total === 0 && scan && <p className="py-5 text-sm text-stone-600">{filter === 'attention' ? 'No issues found.' : 'No records to show.'}</p>}
          <ul className="divide-y divide-stone-200">
            {filter === 'removed' ? cleaning.ignored.slice(pageStart, pageStart + PAGE_SIZE).map(({ number, duplicateOf }) => (
              <li key={number} className="py-2 text-sm">Record {number} · {duplicateOf === undefined ? 'Empty' : `Exact duplicate of record ${duplicateOf}`}</li>
            )) : recordList.slice(pageStart, pageStart + PAGE_SIZE).map((record) => <li key={record.number} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <label className="flex min-w-0 items-baseline gap-2 font-medium">
                  <input type="checkbox" checked={selected.has(record.number)} disabled={Boolean(record.blocked) || issuing}
                    onChange={(event) => setOmitted((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.delete(record.number);
                      else next.add(record.number);
                      return next;
                    })} />
                  <span className="break-all">Record {record.number} · {record.name || 'Missing name'}{record.email && ` · ${record.email}`}</span>
                </label>
                <button type="button" disabled={!scan} className="text-xs font-semibold text-primary-700 underline disabled:opacity-50"
                  onClick={() => viewSample(record)}>Preview record {record.number}</button>
              </div>
              <div className="mt-1 space-y-1 pl-5 text-xs text-stone-700">
                {record.blocked && <p className="text-red-700">{record.blocked}</p>}
                {record.note && <p>{record.note}</p>}
                {related.notes.get(record.number)?.map((note) => <p key={note}>{note}</p>)}
                {scan?.result.get(record.number)?.messages.map((issue) => <p key={issue} className="text-amber-800">{issue}</p>)}
              </div>
            </li>)}
          </ul>
          {total > PAGE_SIZE && <nav aria-label="Batch review pages" className="flex items-center justify-between border-t border-stone-200 pt-3 text-sm">
            <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0} className="underline disabled:opacity-40">Previous</button>
            <span>{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, total)} of {total}</span>
            <button type="button" onClick={() => setPage(currentPage + 1)} disabled={pageStart + PAGE_SIZE >= total} className="underline disabled:opacity-40">Next</button>
          </nav>}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-stone-200 px-5 py-4 text-sm">
          <p className="mr-auto text-xs text-stone-600">{unresolved ? 'Uncheck extra records with the same name and email.' : 'Issuance saves the selected certificates with this design.'}</p>
          <button type="button" onClick={onClose} disabled={issuing} className="font-semibold underline disabled:opacity-50">Back to editing</button>
          <button type="button" onClick={() => void issue()} disabled={issuing || !scan || !selected.size || unresolved}
            className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-40">{issuing ? 'Issuing…' : `Issue ${selected.size} ${selected.size === 1 ? 'certificate' : 'certificates'}`}</button>
        </footer>
      </div>
    </dialog>
  );
}
