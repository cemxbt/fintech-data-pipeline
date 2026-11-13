import 'dotenv/config';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateSample } from '../scripts/generate-sample.js';
import { RejectRateExceededError, enrich, migrate, runPipeline } from '../src/index.js';
import { Candle } from '../src/types.js';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://app:app@localhost:5432/market',
});
const dir = mkdtempSync(join(tmpdir(), 'pipeline-'));
const sampleFile = join(dir, 'DEMO-1h.csv');
writeFileSync(sampleFile, generateSample());

const run = (source = sampleFile, extra = {}) =>
  runPipeline({ pool, source, symbol: 'DEMO', interval: '1h', ...extra });

beforeEach(async () => {
  await pool.query('DROP TABLE IF EXISTS candles, pipeline_runs, schema_migrations');
  await migrate(pool, fileURLToPath(new URL('../migrations', import.meta.url)));
});

afterAll(async () => {
  await pool.end();
});

describe('runPipeline', () => {
  it('loads valid candles and reports every data-quality issue in the sample', async () => {
    const report = await run();

    expect(report.rejected.byReason).toEqual({
      'high below open/close/low': 1,
      'invalid timestamp': 1,
    });
    expect(report.duplicates.identical).toBe(1);
    expect(report.quality.gaps).toEqual([
      { from: '2026-01-17T16:00:00.000Z', to: '2026-01-17T18:00:00.000Z', missingCandles: 3 },
    ]);
    expect(report.quality.outliers.map((o) => o.openTime)).toContain('2026-02-07T12:00:00.000Z');
    expect(report.rowsUpserted).toBe(24 * 60 - 3);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n, count(rsi_14)::int AS with_rsi FROM candles`,
    );
    expect(rows[0]).toEqual({ n: 1437, with_rsi: 1437 - 14 });

    const { rows: runs } = await pool.query('SELECT report FROM pipeline_runs');
    expect(runs[0].report.rowsUpserted).toBe(1437);
  });

  it('is idempotent: re-running the same file changes nothing', async () => {
    await run();
    const before = await pool.query('SELECT * FROM candles ORDER BY open_time');
    await run();
    const after = await pool.query('SELECT * FROM candles ORDER BY open_time');
    expect(after.rowCount).toBe(before.rowCount);
    const strip = (rows: Record<string, unknown>[]) => rows.map(({ ingested_at, ...r }) => r);
    expect(strip(after.rows)).toEqual(strip(before.rows));
  });

  it('stores prices exactly as given, without floating-point drift', async () => {
    const file = join(dir, 'precise.csv');
    writeFileSync(
      file,
      'timestamp,open,high,low,close,volume\n2026-03-01T00:00:00Z,0.10000001,0.30000003,0.1,0.2,123456.12345678\n',
    );
    await run(file);
    const { rows } = await pool.query('SELECT open::text, high::text, volume::text FROM candles');
    expect(rows[0]).toEqual({ open: '0.10000001', high: '0.30000003', volume: '123456.12345678' });
  });

  it('warms indicators up from stored history on incremental runs', async () => {
    const lines = generateSample().trim().split('\n');
    const header = lines[0]!;
    const body = lines.slice(1).filter((l) => !l.startsWith('not-a-date'));
    const firstHalf = join(dir, 'first.csv');
    const secondHalf = join(dir, 'second.csv');
    writeFileSync(firstHalf, [header, ...body.slice(0, 700)].join('\n'));
    writeFileSync(secondHalf, [header, ...body.slice(700)].join('\n'));

    await run(firstHalf);
    const report = await run(secondHalf);
    expect(report.warmupCandles).toBe(100);

    const incremental = await pool.query('SELECT ema_26, rsi_14 FROM candles ORDER BY open_time');
    await pool.query('TRUNCATE candles');
    await run(sampleFile);
    const full = await pool.query('SELECT ema_26, rsi_14 FROM candles ORDER BY open_time');

    // With enough warm-up the incremental result converges to the full recomputation.
    const tail = (rows: { ema_26: number; rsi_14: number }[]) =>
      rows.slice(-200).map((r) => [Number(r.ema_26.toFixed(6)), Number(r.rsi_14.toFixed(4))]);
    expect(tail(incremental.rows)).toEqual(tail(full.rows));
  });

  it('refuses to load a file with too many invalid rows', async () => {
    const file = join(dir, 'bad.csv');
    writeFileSync(file, 'timestamp,open,high,low,close,volume\nx,1,1,1,1,1\nnope,1,1,1,1,1\n');
    await expect(run(file)).rejects.toBeInstanceOf(RejectRateExceededError);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM candles');
    expect(rows[0].n).toBe(0);
  });
});

describe('enrich', () => {
  it('produces indicator values only once enough history exists', () => {
    const candles: Candle[] = Array.from({ length: 40 }, (_, i) => ({
      openTime: Date.UTC(2026, 0, 1) + i * 3_600_000,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100 + i,
      volume: 10,
      raw: { open: '', high: '', low: '', close: '', volume: '' },
    }));
    const enriched = enrich(candles);
    expect(enriched[18]!.sma20).toBeNull();
    expect(enriched[19]!.sma20).toBe(109.5);
    expect(enriched[24]!.ema26).toBeNull();
    expect(enriched[25]!.ema26).not.toBeNull();
    expect(enriched[39]!.rsi14).toBe(100);
  });
});
