'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileSpreadsheet, UserPlus } from 'lucide-react';
import type { DashboardParticipant } from '../api/dashboard/route';
import {
  apiFetch, fetchEventDesign, registerCertificates,
  type EventDesignResponse, type RegisterCertificateItem,
} from '../../lib/api-client';
import { freezeRenderFields, getDesignFields } from '../../lib/render-fields';
import { emailIssuedCertificate, renderIssuedPreview } from '../../lib/issued-certificate';
import { parseCsv, type ParsedCsv } from '../../lib/csv-parser';

const names = ['name', 'fullname', 'recipientname', 'studentname', 'participantname', 'candidatename', 'membername'];
const emails = ['email', 'emailaddress', 'recipientemail', 'mail'];
const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s_-]/g, '');
const identity = (name: string, email?: string | null) =>
  JSON.stringify([name.trim().toLowerCase(), email?.trim().toLowerCase() ?? '']);
const emailPattern = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

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
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  useEffect(() => () => { if (previewImage) URL.revokeObjectURL(previewImage); }, [previewImage]);

  const design = designResponse?.design;
  const fields = useMemo(() => design ? getDesignFields(design.layoutConfig) : [], [design]);
  const customFields = fields.filter((field) => !names.includes(normalize(field)) && !emails.includes(normalize(field)));
  const existing = useMemo(() => new Map(participants.map((row) => [
    identity(row.recipientName, row.recipientEmail), row.renderFields ?? row.rowData ?? {},
  ])), [participants]);

  async function open(next: typeof mode) {
    setMode(next);
    setPreviewImage(null);
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
      const [outcome] = await registerCertificates([{ recipientName: person, recipientEmail: address, rowData }], { eventId });
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
          design, freezeRenderFields(design.layoutConfig, rowData), { id: outcome.id, name: person, email: address }, eventName,
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
    setPreviewImage(null);
    setNotice(null);
    if (!file) return;
    try {
      const parsed = parseCsv(await file.text());
      const findColumn = (choices: string[]) => parsed.headers.find((header) => choices.includes(normalize(header))) ?? '';
      setNameColumn(findColumn(names));
      setEmailColumn(findColumn(emails));
      setColumnMap(Object.fromEntries(customFields.map((field) => [field, findColumn([normalize(field)])])));
      setCsv(parsed);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not read the CSV file.', error: true });
    }
  }

  const seen = new Map<string, Record<string, string>>();
  const preview = csv && nameColumn ? csv.data.map((row, index) => {
    const recipientName = row[nameColumn]?.trim() ?? '';
    const recipientEmail = row[emailColumn]?.trim() ?? '';
    const key = identity(recipientName, recipientEmail);
    const rowData = Object.fromEntries(fields.map((field) => [
      field, names.includes(normalize(field)) ? recipientName
        : emails.includes(normalize(field)) ? recipientEmail
        : row[columnMap[field]] ?? '',
    ]));
    const prior = existing.get(key) ?? seen.get(key);
    const state = !recipientName || (recipientEmail && !emailPattern.test(recipientEmail)) ? 'Invalid'
      : prior ? fields.some((field) => (prior[field] ?? '') !== rowData[field]) ? 'Conflict' : 'Duplicate'
      : 'Ready';
    if (state === 'Ready') seen.set(key, rowData);
    return { item: { recipientName, recipientEmail, rowData }, state, index };
  }) : [];
  const ready = preview.filter(({ state }) => state === 'Ready');

  async function previewFirstCertificate() {
    const item = ready[0]?.item;
    if (!design || !item || working) return;
    setWorking(true);
    setNotice(null);
    try {
      const image = await renderIssuedPreview(design, freezeRenderFields(design.layoutConfig, item.rowData), item.recipientName);
      setPreviewImage(URL.createObjectURL(image));
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : 'Could not preview the certificate.', error: true });
    } finally {
      setWorking(false);
    }
  }

  async function addBulk() {
    if (!design || working || !ready.length) return;
    setWorking(true);
    setNotice(null);
    let added = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < ready.length; i += 500) {
        const items: RegisterCertificateItem[] = ready.slice(i, i + 500).map(({ item }) => item);
        const outcomes = await registerCertificates(items, { eventId });
        added += outcomes.filter(({ status }) => status === 'issued').length;
        skipped += outcomes.filter(({ status }) => status !== 'issued').length;
      }
      setCsv(null);
      setPreviewImage(null);
      setNotice({ text: `Added ${added} ${added === 1 ? 'recipient' : 'recipients'}.${skipped ? ` ${skipped} already had certificates at issuance.` : ''}` });
    } catch (error) {
      setNotice({
        text: `${added ? `Added ${added} before the request stopped. ` : ''}${error instanceof Error ? error.message : 'CSV issuance failed.'}`,
        error: true,
      });
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
                <ColumnPicker title="Recipient name" headers={csv.headers} value={nameColumn} onChange={(column) => { setNameColumn(column); setPreviewImage(null); }} />
                <ColumnPicker title="Recipient email" headers={csv.headers} value={emailColumn} onChange={(column) => { setEmailColumn(column); setPreviewImage(null); }} />
                {customFields.map((field) => <ColumnPicker key={field} title={field} headers={csv.headers}
                  value={columnMap[field] ?? ''} onChange={(column) => { setColumnMap({ ...columnMap, [field]: column }); setPreviewImage(null); }} />)}
              </div>
              {nameColumn && <>
                <p className="text-sm text-slate-700" role="status">
                  {ready.length} ready · {preview.filter(({ state }) => state === 'Duplicate').length} duplicate · {preview.filter(({ state }) => state === 'Invalid').length} invalid
                  {preview.some(({ state }) => state === 'Conflict') && ` · ${preview.filter(({ state }) => state === 'Conflict').length} conflicting`}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <caption className="text-left font-semibold pb-1">CSV preview · first {Math.min(8, preview.length)} rows</caption>
                    <thead className="border-b border-stone-200"><tr>
                      {['Name', 'Email', ...customFields, 'Status'].map((header, index) => <th key={index} className="py-1 pr-3">{header}</th>)}
                    </tr></thead>
                    <tbody className="divide-y divide-stone-200">
                      {preview.slice(0, 8).map(({ item, index, state }) => <tr key={index}>
                        {[item.recipientName, item.recipientEmail, ...customFields.map((field) => item.rowData[field]), state]
                          .map((value, i) => <td key={i} className="py-1 pr-3">{value || '—'}</td>)}
                      </tr>)}
                    </tbody>
                  </table>
                </div>
                {previewImage && <img src={previewImage} alt="Preview of the first new certificate" className="max-h-56 max-w-full object-contain" />}
                <div className="flex flex-wrap gap-3">
                  <button type="button" disabled={working || ready.length === 0} onClick={() => void previewFirstCertificate()}
                    className="text-xs font-semibold text-slate-700 underline disabled:opacity-50">Preview certificate</button>
                  <button type="button" className={buttonClass} disabled={working || ready.length === 0} onClick={() => void addBulk()}>
                    Issue {ready.length} {ready.length === 1 ? 'certificate' : 'certificates'}
                  </button>
                </div>
              </>}
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
