'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { FileSpreadsheet, UserPlus } from 'lucide-react';
import type { DashboardParticipant } from '../api/dashboard/route';
import {
  apiFetch, fetchEventDesign, registerCertificates,
  type EventDesignResponse, type RegisterCertificateItem,
} from '../../lib/api-client';
import { freezeRenderFields, getDesignFields } from '../../lib/render-fields';
import { emailIssuedCertificate } from '../../lib/issued-certificate';
import { BatchReviewDialog } from '../../components/modals/BatchReviewDialog';
import { rosterIdentity, type ReviewRecord } from '../../lib/batch-review';
import { singleRecipientEmail } from '../../lib/mail-preferences';
import { decodeDesignImage } from '../../lib/workspace-loader';
import { readCsvFile, type ParsedCsv } from '../../lib/csv-parser';

const names = ['name', 'fullname', 'recipientname', 'studentname', 'participantname', 'candidatename', 'membername'];
const emails = ['email', 'emailaddress', 'recipientemail', 'mail'];
const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_-]/g, '');
const inputClass = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm';
const buttonClass = 'inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50';

interface EventRecipientsProps {
  eventId: string;
  eventName: string;
  designLocked: boolean;
  participants: DashboardParticipant[];
  onChange: () => Promise<void>;
}

export function EventRecipients({ eventId, eventName, designLocked, participants, onChange }: EventRecipientsProps) {
  const [mode, setMode] = useState<'individual' | 'bulk' | 'confirm' | null>(null);
  const [designResponse, setDesignResponse] = useState<EventDesignResponse | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [emailNow, setEmailNow] = useState(false);
  const [individualFields, setIndividualFields] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [nameColumn, setNameColumn] = useState('');
  const [emailColumn, setEmailColumn] = useState('');
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});
  const [batchReview, setBatchReview] = useState<{ image: HTMLImageElement; records: ReviewRecord[] } | null>(null);

  const design = designResponse?.design;
  const fields = useMemo(() => design ? getDesignFields(design.layoutConfig) : [], [design]);
  const customFields = fields.filter((field) => !names.includes(normalize(field)) && !emails.includes(normalize(field)));
  const existing = useMemo(() => ({
    byIdentity: new Map(participants.map((row) => [rosterIdentity(row.recipientName, row.recipientEmail), row])),
    names: new Set(participants.map((row) => row.recipientName.trim().toLowerCase())),
    addresses: new Set(participants.map((row) => row.recipientEmail?.trim().toLowerCase()).filter(Boolean)),
  }), [participants]);

  async function open(next: typeof mode) {
    setMode(next);
    setNotice(null);
    if (!next || (design && (next === 'confirm' || designResponse.event.designLocked))) return;
    setWorking(true);
    try {
      const result = await fetchEventDesign(eventId);
      setDesignResponse(result);
      if (!result.design) setNotice({ text: 'The original artwork is unavailable.', error: true });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not load the design.', error: true });
    } finally {
      setWorking(false);
    }
  }

  async function confirmDesign() {
    if (!designResponse?.revision || working) return;
    setWorking(true);
    setNotice(null);
    try {
      const response = await apiFetch(`/api/events/${eventId}/design`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: designResponse.revision }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) setDesignResponse(null);
        throw new Error(data.detail || 'Could not confirm the design.');
      }
      setDesignResponse(null);
      setMode(null);
      await onChange();
      setNotice({ text: 'Original design confirmed. Public downloads and recipient additions are available.' });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not confirm the design.', error: true });
    } finally {
      setWorking(false);
    }
  }

  async function addIndividual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!design || working || !name.trim()) return;
    const person = name.trim();
    const address = email.trim();
    const rowData = Object.fromEntries(fields.map((field) => [
      field,
      names.includes(normalize(field)) ? person
        : emails.includes(normalize(field)) ? address
        : individualFields[field] ?? '',
    ]));
    setWorking(true);
    setNotice(null);
    let added = false;
    try {
      const { outcomes: [outcome] } = await registerCertificates([{ recipientName: person, recipientEmail: address, rowData }], { eventId });
      if (outcome.status !== 'issued') {
        setNotice({
          text: outcome.status === 'conflict' ? 'This recipient already has a certificate with different values.' : 'This recipient is already registered.',
          error: outcome.status === 'conflict',
        });
        return;
      }
      added = true;
      setName('');
      setEmail('');
      setIndividualFields({});
      if (emailNow && address) {
        const result = await emailIssuedCertificate(
          design, freezeRenderFields(design.layoutConfig, rowData), { id: outcome.id, name: person, email: address },
          eventName, designResponse?.mailPreferences, rowData,
        );
        setNotice({ text: result.status === 'success' ? 'Recipient added. Gmail accepted the email.' : `Recipient added. ${result.message}` });
      } else {
        setNotice({ text: 'Recipient added.' });
      }
    } catch (error) {
      setNotice({ text: `${added ? 'Recipient added. ' : ''}${error instanceof Error ? error.message : 'Could not add the recipient.'}`, error: !added });
    } finally {
      if (added) await onChange();
      setWorking(false);
    }
  }

  async function loadCsv(file?: File) {
    setCsv(null);
    setNotice(null);
    if (!file) return;
    try {
      const parsed = await readCsvFile(file);
      const findColumn = (choices: string[]) => parsed.headers.find((header) => choices.includes(normalize(header))) ?? '';
      setNameColumn(findColumn(names));
      setEmailColumn(findColumn(emails));
      setColumnMap(Object.fromEntries(customFields.map((field) => [field, findColumn([normalize(field)])])));
      setCsv(parsed);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not read the CSV file.', error: true });
    }
  }

  async function openBatchReview() {
    if (!csv || !nameColumn || !design || working) return;
    setWorking(true);
    setNotice(null);
    try {
      const image = await decodeDesignImage(design);
      const extra = new Set(csv.review.extraColumns);
      const records = csv.data.map((row, index) => {
        const number = csv.review.numbers[index];
        const name = row[nameColumn]?.trim() ?? '';
        const email = row[emailColumn]?.trim() ?? '';
        const rowData = {
          ...row,
          ...Object.fromEntries(fields.map((field) => [
            field, names.includes(normalize(field)) ? name
              : emails.includes(normalize(field)) ? email : row[columnMap[field]] ?? '',
          ])),
        };
        const prior = existing.byIdentity.get(rosterIdentity(name, email));
        const priorFields = prior?.renderFields ?? prior?.rowData ?? {};
        const currentFields = freezeRenderFields(design.layoutConfig, rowData);
        const different = fields.some((field) => (priorFields[field] ?? '') !== currentFields[field]);
        const blocked = extra.has(number) ? 'This record has more values than the CSV header. Fix the CSV and import it again.'
          : !name ? 'Map a name column and fill in a recipient name.'
          : email && (email.length > 320 || !singleRecipientEmail.test(email)) ? 'Fix the recipient email in the CSV or omit this record.'
          : prior ? different ? 'This recipient already has an issued certificate with different printed values.'
            : 'This recipient already has an issued certificate.' : undefined;
        const note = !prior && (existing.names.has(name.toLowerCase()) || (email && existing.addresses.has(email.toLowerCase())))
          ? 'An existing recipient shares this name or email. Check whether both certificates are needed.' : undefined;
        return { number, row: rowData, name, email, blocked, note };
      });
      setBatchReview({ image, records });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not open the batch review.', error: true });
    } finally {
      setWorking(false);
    }
  }

  async function addBulk(selected: Set<number>) {
    if (!design || working || !batchReview || !designResponse?.event.designLocked) return;
    const ready = batchReview.records.filter(({ number, blocked }) => selected.has(number) && !blocked);
    if (!ready.length) return;
    setWorking(true);
    setNotice(null);
    let added = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < ready.length; i += 500) {
        const items: RegisterCertificateItem[] = ready.slice(i, i + 500).map(({ name, email, row }) => ({
          recipientName: name, recipientEmail: email, rowData: row,
        }));
        const { outcomes } = await registerCertificates(items, { eventId });
        added += outcomes.filter(({ status }) => status === 'issued').length;
        skipped += outcomes.filter(({ status }) => status !== 'issued').length;
      }
      setCsv(null);
      setNotice({ text: `Added ${added} ${added === 1 ? 'recipient' : 'recipients'}.${skipped ? ` ${skipped} already had certificates at issuance.` : ''}` });
    } catch (error) {
      throw new Error(`${added ? `Added ${added} before the request stopped. ` : ''}${error instanceof Error ? error.message : 'CSV issuance failed.'}`);
    } finally {
      await onChange();
      setWorking(false);
    }
  }

  const modeButton = (selected: NonNullable<typeof mode>, label: string, icon?: React.ReactNode) => (
    <button type="button" aria-pressed={mode === selected} disabled={working}
      onClick={() => void open(mode === selected && design ? null : selected)}
      className="inline-flex items-center gap-1.5 border-b border-stone-300 py-1 text-xs font-semibold text-slate-800 hover:border-slate-900 disabled:opacity-50">
      {icon}{label}
    </button>
  );

  return (
    <section aria-label="Add recipients" className="space-y-3 border-b border-stone-200 pb-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {designLocked ? <>
          {modeButton('individual', 'Add one recipient', <UserPlus className="h-4 w-4" />)}
          {modeButton('bulk', 'Add recipients via CSV', <FileSpreadsheet className="h-4 w-4" />)}
        </> : modeButton('confirm', 'Review original design')}
      </div>
      {working && <p className="text-xs text-stone-600" role="status">Working…</p>}
      {notice && <p role="status" className={`text-sm ${notice.error ? 'text-red-700' : 'text-slate-700'}`}>{notice.text}</p>}

      {mode === 'confirm' && design && (
        <div className="max-w-lg space-y-2">
          <img src={design.imageData} alt="Saved certificate artwork" className="max-h-48 max-w-full object-contain" />
          <p className="text-sm text-slate-700">
            Confirm this is the design originally issued. Its printed values will be available on existing public certificate links.
          </p>
          <p className="text-xs text-slate-600">Printed fields: {fields.join(', ') || 'No roster fields'}</p>
          <button type="button" className={buttonClass} disabled={working} onClick={() => void confirmDesign()}>
            Confirm original design
          </button>
        </div>
      )}

      {mode === 'individual' && design && (
        <form onSubmit={addIndividual} className="max-w-3xl space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-semibold">Full name<input className={inputClass} value={name} required onChange={(e) => setName(e.target.value)} /></label>
            <label className="text-xs font-semibold">Email<input className={inputClass} value={email} type="email" required={emailNow} onChange={(e) => setEmail(e.target.value)} /></label>
            {customFields.map((field) => (
              <label key={field} className="text-xs font-semibold">{field}
                <input className={inputClass} value={individualFields[field] ?? ''} onChange={(e) => setIndividualFields({ ...individualFields, [field]: e.target.value })} />
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={emailNow} onChange={(e) => setEmailNow(e.target.checked)} /> Email the certificate now</label>
          <button className={buttonClass} disabled={working}>Issue certificate</button>
        </form>
      )}

      {mode === 'bulk' && design && (
        <div className="space-y-3">
          <label className="block max-w-md text-xs font-semibold">Recipient CSV
            <input type="file" accept=".csv,text/csv" aria-label="Recipient CSV" disabled={working}
              className={inputClass} onChange={(e) => void loadCsv(e.target.files?.[0])} />
          </label>
          {csv && (
            <>
              <div className="grid max-w-3xl gap-2 sm:grid-cols-3">
                <ColumnPicker title="Recipient name" headers={csv.headers} value={nameColumn} onChange={setNameColumn} />
                <ColumnPicker title="Recipient email" headers={csv.headers} value={emailColumn} onChange={setEmailColumn} />
                {customFields.map((field) => <ColumnPicker key={field} title={field} headers={csv.headers}
                  value={columnMap[field] ?? ''} onChange={(column) => setColumnMap({ ...columnMap, [field]: column })} />)}
              </div>
              <button type="button" disabled={working || !nameColumn} onClick={() => void openBatchReview()} className={buttonClass}>
                Review CSV batch
              </button>
              {batchReview && <BatchReviewDialog title={`Review CSV batch · ${eventName}`}
                records={batchReview.records} cleaning={csv.review} template={batchReview.image} layout={design.layoutConfig}
                onClose={() => setBatchReview(null)} onIssue={addBulk} />}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ColumnPicker({ title, headers, value, onChange }: {
  title: string; headers: string[]; value: string; onChange: (column: string) => void;
}) {
  return <label className="text-xs font-semibold">{title}
    <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a column</option>
      {headers.map((header) => <option key={header} value={header}>{header}</option>)}
    </select>
  </label>;
}
