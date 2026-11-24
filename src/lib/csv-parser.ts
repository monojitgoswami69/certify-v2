/**
 * RFC-4180 Compliant CSV Parser
 * 
 * Handles quoted fields, commas inside quotes, double quote escapes (""),
 * and newline characters inside fields.
 */

export interface ParsedCsv {
  headers: string[];
  data: Record<string, string>[];
  review: CsvReviewMetadata;
}

export interface CsvReviewMetadata {
  numbers: number[];
  ignored: Array<{ number: number; duplicateOf?: number }>;
  extraColumns?: number[];
  renamedHeaders?: Array<{ column: number; name: string; header: string }>;
}

export function cleanCsvRows(data: Record<string, string>[], numbers = data.map((_, index) => index + 2)) {
  const kept: ParsedCsv['data'] = [];
  const review: CsvReviewMetadata = { numbers: [], ignored: [] };
  const seen = new Map<string, number>();
  data.forEach((row, index) => {
    const number = numbers[index];
    if (!Object.values(row).some((value) => value.trim())) {
      review.ignored.push({ number });
      return;
    }
    const key = JSON.stringify(Object.entries(row));
    const duplicateOf = seen.get(key);
    if (duplicateOf !== undefined) review.ignored.push({ number, duplicateOf });
    else {
      seen.set(key, number);
      review.numbers.push(number);
      kept.push(row);
    }
  });
  return { data: kept, review };
}

export function parseCsv(text: string): ParsedCsv {
  // Strip leading UTF-8 Byte Order Mark (BOM) if present (standard in Excel exports)
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;
  // Tracks whether the current field ever entered a quoted section. RFC-4180
  // says whitespace inside quoted fields must be preserved, so we only trim
  // fields that were entirely unquoted.
  let fieldWasQuoted = false;
  const pushField = () => {
    currentRow.push(fieldWasQuoted ? currentField : currentField.trim());
    currentField = '';
    fieldWasQuoted = false;
  };
  const pushRow = () => {
    rows.push(currentRow);
    currentRow = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++;
        } else {
          // Closing quote
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        fieldWasQuoted = true;
      } else if (char === ',') {
        pushField();
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        pushField();
        pushRow();
      } else if (char === '\n') {
        pushField();
        pushRow();
      } else {
        currentField += char;
      }
    }
  }

  if (insideQuotes) {
    throw new Error('Malformed CSV: a quoted field is never closed. Check for a stray " character.');
  }

  // Push remaining field and row if any
  if (currentField || fieldWasQuoted || currentRow.length > 0) {
    pushField();
    pushRow();
  }

  const headerIndex = rows.findIndex((row) => row.some((value) => value.trim()));
  if (headerIndex < 0 || rows.length <= headerIndex + 1) {
    throw new Error('CSV file must contain a header row and at least one data row.');
  }

  const sourceHeaders = rows[headerIndex];
  const records = rows.slice(headerIndex + 1);
  const extraColumns: number[] = [];
  records.forEach((record, index) => {
    if (record.slice(sourceHeaders.length).some((field) => field.trim())) {
      extraColumns.push(headerIndex + index + 2);
    }
  });
  const rawHeaders = extraColumns.length ? [...sourceHeaders, 'Extra CSV values'] : sourceHeaders;
  const cleanHeaders = rawHeaders.map((header, index) =>
    header.replace(/^\uFEFF/, '').replace(/^"|"$/g, '').trim() || `Column_${index + 1}`
  );
  const reservedHeaders = new Set(cleanHeaders);
  const usedHeaders = new Set<string>();
  const nextSuffixes = new Map<string, number>();
  const headers = cleanHeaders.map((header) => {
    if (!usedHeaders.has(header)) {
      usedHeaders.add(header);
      return header;
    }
    let suffix = nextSuffixes.get(header) ?? 2;
    while (reservedHeaders.has(`${header}_${suffix}`) || usedHeaders.has(`${header}_${suffix}`)) suffix++;
    const unique = `${header}_${suffix}`;
    usedHeaders.add(unique);
    nextSuffixes.set(header, suffix + 1);
    return unique;
  });

  const cleaned = cleanCsvRows(records.map((values) => Object.fromEntries(
    headers.map((header, index) => [header, index < sourceHeaders.length ? values[index] ?? ''
      : values.slice(index).some((value) => value.trim()) ? JSON.stringify(values.slice(index)) : '']),
  )), records.map((_, index) => headerIndex + index + 2));
  cleaned.review.extraColumns = extraColumns;
  cleaned.review.renamedHeaders = headers.flatMap((header, index) => index < sourceHeaders.length && header !== rawHeaders[index].trim()
    ? [{ column: index + 1, name: rawHeaders[index].trim(), header }] : []);
  return { headers, ...cleaned };
}

export async function readCsvFile(file: File): Promise<ParsedCsv> {
  if (file.size > 20 * 1024 * 1024) throw new Error('CSV files can be up to 20 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  return parseCsv(new TextDecoder(encoding).decode(bytes));
}
