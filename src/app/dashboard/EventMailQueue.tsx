'use client';

import { useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import type { DashboardParticipant } from '../api/dashboard/route';
import { EmailDeliveryBlockedError, EmailRateLimitError, EmailUnconfirmedError, IssuanceAccessRequiredError, fetchEventDesign, reviewCertificateMail, sendEmailV2 } from '../../lib/api-client';
import { prepareIssuedEmail } from '../../lib/issued-certificate';
import { delay } from '../../lib/utils';
import { BackgroundBatchPanel } from '../../components/email/BackgroundBatchPanel';
import type { PersistedMailStatus } from '../../types';

export const mailStatusLabels: Record<PersistedMailStatus, string> = {
  pending: 'Pending', failed: 'Failed', accepted: 'Accepted by Gmail', sending: 'In flight', unknown: 'Unknown',
};

interface EventMailQueueProps {
  eventId: string;
  participants: DashboardParticipant[];
  onChange: () => Promise<void>;
}

export function EventMailQueue({ eventId, participants, onChange }: EventMailQueueProps) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [limit, setLimit] = useState(15);
  const [notice, setNotice] = useState('');
  const [designResponse, setDesignResponse] = useState<Awaited<ReturnType<typeof fetchEventDesign>> | null>(null);
  const queueActive = useRef(false);
  const stop = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop.current = true; };
  }, []);

  const recipients = participants.filter((row) => row.recipientEmail && row.status !== 'revoked');
  const ready = recipients.filter((row) => row.renderFields && (row.mailStatus === 'pending' || row.mailStatus === 'failed'));
  const unknown = recipients.filter((row) => row.mailStatus === 'unknown');
  const inFlight = recipients.filter((row) => row.mailStatus === 'sending').length;
  const accepted = recipients.filter((row) => row.mailStatus === 'accepted').length;
  const failed = recipients.filter((row) => row.mailStatus === 'failed').length;
  const pending = recipients.filter((row) => row.mailStatus === 'pending').length;
  const preferences = designResponse?.mailPreferences;

  async function openQueue() {
    setOpen(true);
    setNotice('');
    try {
      const response = await fetchEventDesign(eventId);
      if (!response.design || !response.event.designLocked) throw new Error('The original certificate design is unavailable.');
      setDesignResponse(response);
      await onChange();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not load this event’s email preferences.');
    }
  }

  async function runQueue() {
    if (queueActive.current || !designResponse?.design || !ready.length) return;
    const { design, event, mailPreferences } = designResponse;
    if (!window.confirm(`Send ${ready.length} pending or failed ${ready.length === 1 ? 'certificate email' : 'certificate emails'} from your connected Gmail account?`)) return;
    queueActive.current = true;
    stop.current = false;
    setRunning(true);
    let completed = 0;
    let acceptedHere = 0;
    let failedHere = 0;
    let stoppedReason = '';
    try {
      for (const row of ready) {
        if (stop.current) break;
        setNotice(`Processing ${completed + 1} of ${ready.length} · ${row.recipientName}`);
        try {
          const message = await prepareIssuedEmail(design, row.renderFields!, {
            id: row.id, name: row.recipientName, email: row.recipientEmail!,
          }, event.name, mailPreferences, row.rowData);
          const sendWhenReady = async () => {
            while (!stop.current) {
              try {
                return await sendEmailV2(message);
              } catch (error) {
                if (!(error instanceof EmailRateLimitError) || error.source !== 'account') throw error;
                setNotice(error.message);
                const end = Date.now() + error.retryAfter * 1000;
                while (!stop.current && Date.now() < end) await delay(Math.min(250, end - Date.now()));
              }
            }
          };
          const result = await sendWhenReady();
          if (!result) break;
          if (result.status === 'reconnect_required') {
            stoppedReason = result.message;
            break;
          }
          acceptedHere++;
        } catch (error) {
          if (error instanceof EmailDeliveryBlockedError) {
            completed++;
            continue;
          }
          if (error instanceof EmailUnconfirmedError || error instanceof EmailRateLimitError || error instanceof IssuanceAccessRequiredError) {
            stoppedReason = error instanceof EmailUnconfirmedError ? 'A send needs review in Gmail Sent.' : error.message;
            break;
          }
          failedHere++;
        }
        completed++;
      }
    } finally {
      if (mounted.current) {
        await onChange();
        setNotice(`${acceptedHere} accepted by Gmail.${failedHere ? ` ${failedHere} failed.` : ''}${stoppedReason ? ` ${stoppedReason}` : stop.current ? ' Queue stopped.' : ''}`);
        setRunning(false);
      }
      queueActive.current = false;
    }
  }

  async function review(row: DashboardParticipant, found: boolean) {
    if (reviewing || running) return;
    const prompt = found ? `Confirm you found this certificate email for ${row.recipientEmail} in Gmail Sent.`
      : `Confirm you checked Gmail Sent for ${row.recipientEmail} and are comfortable making this certificate eligible to send.`;
    if (!window.confirm(prompt)) return;
    setReviewing(row.id);
    try {
      await reviewCertificateMail(row.id, row.mailVersion, found);
      setNotice(found ? 'Recorded as confirmed in Gmail Sent.' : 'Recipient returned to Pending.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not save the review.');
    } finally {
      await onChange();
      setReviewing(null);
    }
  }

  const formatList = preferences ? [preferences.attachPdf && 'PDF', preferences.attachJpg && 'JPG', preferences.attachPng && 'PNG'].filter(Boolean).join(', ') : 'PDF';
  return <section aria-label="Certificate email delivery" className="space-y-3 border-b border-stone-200 pb-4">
    <button type="button" aria-expanded={open} disabled={running} onClick={() => { if (open) setOpen(false); else void openQueue(); }}
      className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 underline underline-offset-4 disabled:opacity-50">
      <Mail className="h-4 w-4" /> Email delivery
    </button>
    <p className="text-xs text-stone-700">{pending} pending · {failed} failed · {accepted} accepted by Gmail · {inFlight} in flight · {unknown.length} unknown</p>
    {open && <>
      {!designResponse && !notice && <p role="status" className="text-sm text-stone-600">Loading email preferences…</p>}
      {designResponse && <p className="text-sm text-stone-700">Attachments {formatList || 'unspecified'}{preferences?.subject ? ` · Subject “${preferences.subject}”` : ''}</p>}
      <div className="flex flex-wrap items-center gap-4">
        {running ? <button type="button" className="text-sm font-semibold underline" onClick={() => { stop.current = true; }}>Stop after current email</button>
          : <button type="button" onClick={() => void runQueue()} disabled={!designResponse || !formatList || !ready.length || Boolean(reviewing)}
            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Send pending and failed ({ready.length})</button>}
        <button type="button" className="text-sm font-semibold underline" disabled={running} onClick={() => void openQueue()}>Refresh delivery status</button>
      </div>
      <BackgroundBatchPanel
        key={eventId}
        eventId={eventId}
        eligibleCertificateIds={ready.map((row) => row.id)}
        mailPreferences={
          preferences ??
          (designResponse
            ? {
                subject: `Your certificate from ${designResponse.event.name}`,
                bodyPlain: 'Congratulations! Your certificate is attached.',
                bodyHtml: '',
                attachPdf: true,
                attachJpg: false,
                attachPng: false,
              }
            : null)
        }
        onBatchProgress={onChange}
      />
      {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
      {unknown.length > 0 && <div>
        <h3 className="font-semibold text-slate-900">Review uncertain sends</h3>
        <p className="mt-1 text-sm text-stone-700">Check the recipient and subject in <a href="https://mail.google.com/mail/u/0/#sent" target="_blank" rel="noreferrer" className="font-semibold underline">Gmail Sent</a> before updating the record.</p>
        <ul className="mt-2 divide-y divide-stone-200">
          {unknown.slice(0, limit).map((row) => <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
            <div className="min-w-0 break-all">
              <p>{row.recipientName} · {row.recipientEmail}</p>
              <p className="text-xs text-stone-600">{row.mailUpdatedAt ? `${new Date(row.mailUpdatedAt).toLocaleString()} · ` : ''}{row.mailDetail || (row.mailUpdatedAt ? 'The send was interrupted.' : 'No historical delivery record.')}</p>
            </div>
            <div className="flex gap-3 text-xs font-semibold">
              <button type="button" disabled={running || Boolean(reviewing)} onClick={() => void review(row, true)} className="underline disabled:opacity-50">Found in Sent</button>
              <button type="button" disabled={running || Boolean(reviewing)} onClick={() => void review(row, false)} className="underline disabled:opacity-50">Allow send</button>
            </div>
          </li>)}
        </ul>
        {unknown.length > limit && <button type="button" onClick={() => setLimit(limit + 15)} className="text-xs font-semibold underline">Show more uncertain sends</button>}
      </div>}
    </>}
  </section>;
}
