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

  // Push remaining field and row if any
  if (currentField || currentRow.length > 0) {
    pushField();
    pushRow();
  }

  if (rows.length < 2) {
    throw new Error('CSV file must contain a header row and at least one data row.');
  }

  const rawHeaders = rows[0];
  const headers = rawHeaders.map((h) => h.replace(/^"|"$/g, '').trim());

  const data: Record<string, string>[] = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const rowObj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      rowObj[header] = values[idx] !== undefined ? values[idx] : '';
    });
    data.push(rowObj);
  }

  return { headers, data };
}
