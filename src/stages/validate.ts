import { Candle } from '../types.js';
import { RawRow } from './extract.js';

export type Rejection = { line: number; reason: string };
export type ValidationResult = { ok: true; candle: Candle } | ({ ok: false } & Rejection);

const DECIMAL = /^\d+(\.\d+)?$/;
const FIELDS = ['open', 'high', 'low', 'close', 'volume'] as const;

/** Accepts ISO-8601 dates, epoch milliseconds or epoch seconds. */
export function parseTimestamp(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const n = Number(value);
    return n >= 1e12 ? n : n * 1000;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

export function validateRow({ line, fields }: RawRow, intervalMs: number): ValidationResult {
  const reject = (reason: string): ValidationResult => ({ ok: false, line, reason });

  const openTime = parseTimestamp(fields.open_time ?? '');
  if (openTime === null) return reject('invalid timestamp');
  if (intervalMs <= 86_400_000 && openTime % intervalMs !== 0) {
    return reject('timestamp not aligned to interval');
  }

  const raw = {} as Candle['raw'];
  for (const field of FIELDS) {
    const value = fields[field] ?? '';
    if (!DECIMAL.test(value)) return reject(`invalid ${field}`);
    raw[field] = value;
  }

  const [open, high, low, close, volume] = FIELDS.map((f) => Number(raw[f])) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return reject('non-positive price');
  if (high < Math.max(open, close, low)) return reject('high below open/close/low');
  if (low > Math.min(open, close)) return reject('low above open/close');

  return { ok: true, candle: { openTime, open, high, low, close, volume, raw } };
}
