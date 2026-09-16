/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** Rows → objects keyed by the header row. */
export function csvRecords(input: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(input);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const needsQuotes = /[",\r\n]/;

/** One CSV line. Leading = + - @ are prefixed so spreadsheets never evaluate a cell as a formula. */
export function csvLine(values: (string | number | boolean | null | undefined)[]): string {
  return (
    values
      .map((v) => {
        let s = v === null || v === undefined ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
        return needsQuotes.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      })
      .join(',') + '\r\n'
  );
}
