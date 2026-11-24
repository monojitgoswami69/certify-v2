import type { CsvRow, TextBox } from '../types';
import { inspectCertificateText } from './certificate-text';
import { ensureFontsLoaded, getFontFamilyCSS } from './font-loader';
import { delay, resolveFieldValue } from './utils';

export interface ReviewRecord {
  number: number;
  row: CsvRow;
  name: string;
  email: string;
  blocked?: string;
  note?: string;
}

export interface LayoutWarnings {
  messages: string[];
  priority: number;
}

export function rankReviewRecords(records: ReviewRecord[], layout: Map<number, LayoutWarnings>) {
  const priority = (record: ReviewRecord) => record.blocked ? 4 : layout.get(record.number)?.priority ?? 0;
  return [...records].sort((left, right) => priority(right) - priority(left));
}

export function selectRecipientName(row: CsvRow, boxes: TextBox[]): string {
  const name = resolveFieldValue('Name', row).trim();
  if (name) return name;
  const firstField = boxes.find((box) => box.kind !== 'static' && box.field.trim())?.field;
  return resolveFieldValue(firstField, row).trim() || Object.values(row)[0]?.trim() || 'Certificate Holder';
}

export function rosterIdentity(name: string, email?: string | null): string {
  return JSON.stringify([name.trim().slice(0, 500).toLowerCase(), email?.trim().toLowerCase() ?? '']);
}

export function relatedRecords(records: ReviewRecord[]) {
  const names = new Map<string, number[]>();
  const addresses = new Map<string, number[]>();
  const identities = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, number: number) => {
    const group = map.get(key);
    if (group) group.push(number);
    else map.set(key, [number]);
  };
  for (const record of records) {
    if (record.blocked) continue;
    add(names, record.name.trim().toLowerCase(), record.number);
    if (record.email) add(addresses, record.email.trim().toLowerCase(), record.number);
    add(identities, rosterIdentity(record.name, record.email), record.number);
  }
  const notes = new Map<number, string[]>();
  const describe = (map: Map<string, number[]>, message: string) => {
    for (const numbers of map.values()) {
      if (numbers.length < 2) continue;
      for (const number of numbers) {
        const match = numbers[0] === number ? numbers[1] : numbers[0];
        const more = numbers.length > 2 ? ` and ${numbers.length - 2} more` : '';
        notes.set(number, [...(notes.get(number) ?? []), `${message} ${match}${more}.`]);
      }
    }
  };
  describe(names, 'Same name as record');
  describe(addresses, 'Same email as record');
  describe(identities, 'Keep at most one record with this name and email. Also found in record');
  return { notes, conflicts: [...identities.values()].filter((group) => group.length > 1) };
}

export async function inspectBatchLayout(records: ReviewRecord[], boxes: TextBox[], width: number, height: number, signal: AbortSignal) {
  const fallbackFonts = await ensureFontsLoaded(new Set(boxes.map((box) => box.fontFamily).filter(Boolean)));
  const result = new Map<number, LayoutWarnings>();
  if (signal.aborted) return { result, fallbackFonts };
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('Certificate text could not be measured in this browser.');
  const layout = boxes.filter((box) => box.kind === 'static' || box.field.trim())
    .map((box) => ({ box, font: getFontFamilyCSS(box.fontFamily) }));
  let sliceStarted = performance.now();
  for (const { number, row } of records) {
    if (signal.aborted) break;
    const issues = new Set<string>();
    let priority = 0;
    for (const { box, font } of layout) {
      const isStatic = box.kind === 'static';
      const label = isStatic ? `Fixed text “${(box.staticText ?? '').slice(0, 32)}”` : `“${box.field}”`;
      const text = isStatic ? (box.staticText ?? '') : resolveFieldValue(box.field, row);
      if (!text.trim()) {
        if (!isStatic) {
          issues.add(`${label} is blank. Fill the CSV field or update its mapping.`);
          priority = Math.max(priority, 2);
        }
      } else {
        const { status, size } = inspectCertificateText(ctx, text, box, font, width, height);
        if (status !== 'fits') {
          issues.add(status === 'overflow' ? `${label} extends past its text box or the artwork. Resize or move the box.`
            : `${label} is tight at ${Math.round(size * 10) / 10} px. Widen the box or shorten the text.`);
          priority = Math.max(priority, status === 'overflow' ? 3 : 2 - size / box.fontSize);
        }
      }
      if (performance.now() - sliceStarted > 12) {
        await delay(0);
        if (signal.aborted) break;
        sliceStarted = performance.now();
      }
    }
    if (issues.size) result.set(number, { messages: [...issues], priority });
  }
  return { result, fallbackFonts };
}
