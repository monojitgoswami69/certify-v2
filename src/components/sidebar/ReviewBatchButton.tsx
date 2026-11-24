'use client';

import { useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { selectRecipientName } from '../../lib/batch-review';
import { singleRecipientEmail } from '../../lib/mail-preferences';
import { BatchReviewDialog } from '../modals/BatchReviewDialog';
import { registerReviewedBatch } from './useBatchRegistration';

export function ReviewBatchButton() {
  const { templateImage, csvData, isBatchRegistering, issuanceStarted } = useAppStore();
  const [review, setReview] = useState<{
    snapshot: ReturnType<typeof useAppStore.getState>;
    records: Parameters<typeof BatchReviewDialog>[0]['records'];
    layout: Parameters<typeof BatchReviewDialog>[0]['layout'];
  } | null>(null);

  function openReview() {
    const snapshot = useAppStore.getState();
    const { csvReview, boxes, qrZones, images, emailColumn, registeredCertIds } = snapshot;
    const extra = new Set(csvReview.extraColumns);
    const records = snapshot.csvData.flatMap((row, index) => {
      const number = csvReview.numbers[index];
      if (registeredCertIds.has(number)) return [];
      const name = selectRecipientName(row, boxes);
      const email = (row[emailColumn] ?? '').trim();
      const blocked = extra.has(number) ? 'This record has more values than the CSV header. Fix the CSV and import it again.'
        : email && (email.length > 320 || !singleRecipientEmail.test(email)) ? 'Fix the recipient email in the CSV or omit this record.' : undefined;
      return [{ number, row, name, email, blocked }];
    });
    setReview({ snapshot, records, layout: { boxes, qrZones, images } });
  }

  return <>
    <button type="button" disabled={!templateImage || !csvData.length || isBatchRegistering} onClick={openReview}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
      {isBatchRegistering ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
      {isBatchRegistering ? 'Issuing certificates…' : issuanceStarted ? 'Review remaining certificates' : 'Review batch'}
    </button>
    {review?.snapshot.templateImage && <BatchReviewDialog
      title={`Review batch · ${review.snapshot.eventName.trim() || 'General Event'}`}
      template={review.snapshot.templateImage} layout={review.layout} records={review.records}
      cleaning={review.snapshot.csvReview} onClose={() => setReview(null)}
      onIssue={(selected) => registerReviewedBatch(review.snapshot, selected)} />}
  </>;
}
