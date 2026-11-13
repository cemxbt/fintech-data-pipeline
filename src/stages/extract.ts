import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export interface RawRow {
  line: number;
  fields: Record<string, string>;
}

const ALIASES: Record<string, string> = {
  timestamp: 'open_time',
  time: 'open_time',
  date: 'open_time',
  opentime: 'open_time',
};

const normaliseHeader = (h: string) => {
  const key = h.trim().toLowerCase().replace(/\s+/g, '_');
  return ALIASES[key.replace(/_/g, '')] ?? ALIASES[key] ?? key;
};

/**
 * Streams a CSV file row by row, so memory use stays flat regardless of file size.
 * Supports a header row with common column names for the open time.
 */
export async function* readCsv(path: string): AsyncGenerator<RawRow> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let header: string[] | undefined;
  let lineNumber = 0;

  for await (const text of lines) {
    lineNumber++;
    if (!text.trim()) continue;
    const cells = text.split(',').map((c) => c.trim());
    if (!header) {
      header = cells.map(normaliseHeader);
      continue;
    }
    const fields: Record<string, string> = {};
    header.forEach((name, i) => (fields[name] = cells[i] ?? ''));
    yield { line: lineNumber, fields };
  }
}
