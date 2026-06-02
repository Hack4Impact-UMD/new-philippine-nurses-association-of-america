// Shared CSV helpers for the bulk-upload features.
//
// Deliberately no external CSV dependency — a single-pass RFC-4180-ish parser
// covers the spreadsheet exports admins paste in. Extracted from the original
// sub-event bulk-attendance component so every bulk importer parses identically.

/** Parse CSV text into a grid of string cells. Handles quoted fields, escaped
 *  quotes (`""`), commas, and newlines. Fully-empty rows are dropped. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (c === "\r") {
        // skip
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

/** Interpret a cell as a yes/no value. Returns null when unparseable. */
export function parseBoolean(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (["yes", "y", "true", "1", "x", "✓"].includes(v)) return true;
  if (["no", "n", "false", "0", "", "-"].includes(v)) return false;
  return null;
}

/** Trigger a client-side download of CSV text (e.g. a template). */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Split an optional header row off a parsed grid. The first row is treated as a
 * header when any of its cells matches one of `knownHeaders` (case-insensitive),
 * which lets adapters read columns by name and tolerate reordering. When no
 * header is detected, callers fall back to fixed positional columns.
 */
export function splitHeader(
  grid: string[][],
  knownHeaders: string[]
): { headerMap: Map<string, number>; dataRows: string[][]; hasHeader: boolean } {
  if (grid.length === 0) {
    return { headerMap: new Map(), dataRows: [], hasHeader: false };
  }
  const first = grid[0].map((c) => c.trim().toLowerCase());
  const known = new Set(knownHeaders.map((h) => h.toLowerCase()));
  const hasHeader = first.some((c) => known.has(c));
  const headerMap = new Map<string, number>();
  if (hasHeader) {
    first.forEach((c, i) => {
      if (c && !headerMap.has(c)) headerMap.set(c, i);
    });
  }
  return { headerMap, dataRows: hasHeader ? grid.slice(1) : grid, hasHeader };
}

/**
 * Read a cell by header name, falling back to a fixed column index when the CSV
 * had no header row. Returns a trimmed string.
 */
export function col(
  row: string[],
  headerMap: Map<string, number>,
  name: string,
  fallbackIdx: number
): string {
  const idx = headerMap.get(name.toLowerCase());
  const at = idx != null ? idx : fallbackIdx;
  return (row[at] ?? "").trim();
}
