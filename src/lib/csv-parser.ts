/**
 * RFC-4180 Compliant CSV Parser
 * 
 * Handles quoted fields, commas inside quotes, double quote escapes (""),
 * and newline characters inside fields.
 */

export interface ParsedCsv {
  headers: string[];
  data: Record<string, string>[];
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
    if (currentRow.some((field) => field.length > 0)) {
      rows.push(currentRow);
    }
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
  if (currentField || currentRow.length > 0) {
    pushField();
    pushRow();
  }

  if (rows.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row.');
  }

  const rawHeaders = rows[0];
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

  const data: Record<string, string>[] = [];

  for (const values of rows.slice(1)) {
    data.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
  }

  return { headers, data };
}
