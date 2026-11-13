import { describe, expect, it } from 'vitest';
import { intervalToMs } from '../src/intervals.js';
import { normalize } from '../src/stages/normalize.js';
import { checkQuality } from '../src/stages/quality.js';
import { parseTimestamp, validateRow } from '../src/stages/validate.js';
import { Candle } from '../src/types.js';

const HOUR = 3_600_000;
const t0 = Date.UTC(2026, 0, 1);

const row = (fields: Partial<Record<string, string>>) => ({
  line: 2,
  fields: {
    open_time: new Date(t0).toISOString(),
    open: '100',
    high: '105',
    low: '95',
    close: '102',
    volume: '10',
    ...fields,
  } as Record<string, string>,
});

const candle = (hours: number, close: number, raw = String(close)): Candle => ({
  openTime: t0 + hours * HOUR,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1,
  raw: { open: raw, high: raw, low: raw, close: raw, volume: '1' },
});

describe('intervalToMs', () => {
  it('parses common intervals and rejects others', () => {
    expect(intervalToMs('15m')).toBe(15 * 60_000);
    expect(intervalToMs('4h')).toBe(4 * HOUR);
    expect(() => intervalToMs('1y')).toThrow();
  });
});

describe('parseTimestamp', () => {
  it('accepts ISO dates, epoch milliseconds and epoch seconds', () => {
    expect(parseTimestamp('2026-01-01T00:00:00Z')).toBe(t0);
    expect(parseTimestamp(String(t0))).toBe(t0);
    expect(parseTimestamp(String(t0 / 1000))).toBe(t0);
    expect(parseTimestamp('yesterday')).toBeNull();
  });
});

describe('validateRow', () => {
  it('accepts a consistent candle and keeps the original decimal strings', () => {
    const result = validateRow(row({ close: '102.12345678' }), HOUR);
    expect(result).toMatchObject({ ok: true, candle: { close: 102.12345678 } });
    if (result.ok) expect(result.candle.raw.close).toBe('102.12345678');
  });

  it.each([
    [{ open_time: 'soon' }, 'invalid timestamp'],
    [{ open_time: new Date(t0 + 60_000).toISOString() }, 'timestamp not aligned to interval'],
    [{ volume: '-1' }, 'invalid volume'],
    [{ close: '1e3' }, 'invalid close'],
    [{ open: '0' }, 'non-positive price'],
    [{ high: '101' }, 'high below open/close/low'],
    [{ low: '101' }, 'low above open/close'],
  ])('rejects %o with "%s"', (fields, reason) => {
    expect(validateRow(row(fields), HOUR)).toMatchObject({ ok: false, reason, line: 2 });
  });
});

describe('normalize', () => {
  it('sorts, drops identical duplicates and keeps the last of conflicting ones', () => {
    const result = normalize([
      candle(2, 3),
      candle(0, 1),
      candle(0, 1),
      candle(1, 2),
      candle(1, 9),
    ]);
    expect(result.candles.map((c) => c.close)).toEqual([1, 9, 3]);
    expect(result.identicalDuplicates).toBe(1);
    expect(result.conflictingDuplicates).toEqual([t0 + HOUR]);
  });
});

describe('checkQuality', () => {
  it('reports gaps with the number of missing candles', () => {
    const report = checkQuality([candle(0, 1), candle(1, 1), candle(5, 1)], HOUR);
    expect(report.gaps).toEqual([
      {
        from: new Date(t0 + 2 * HOUR).toISOString(),
        to: new Date(t0 + 4 * HOUR).toISOString(),
        missingCandles: 3,
      },
    ]);
    expect(report.missingCandles).toBe(3);
  });

  it('flags moves far outside recent volatility', () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 * (1 + (i % 2 ? 0.001 : -0.001)));
    closes[70] = closes[69]! * 1.2;
    const report = checkQuality(
      closes.map((c, i) => candle(i, c)),
      HOUR,
      { window: 50, zThreshold: 6 },
    );
    expect(report.outliers.map((o) => o.openTime)).toContain(
      new Date(t0 + 70 * HOUR).toISOString(),
    );
  });
});
