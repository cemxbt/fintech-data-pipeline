import pg from 'pg';
import { intervalToMs } from './intervals.js';
import { enrich } from './stages/enrich.js';
import { readCsv, RawRow } from './stages/extract.js';
import { loadWarmup, upsertCandles } from './stages/load.js';
import { normalize } from './stages/normalize.js';
import { checkQuality, QualityReport } from './stages/quality.js';
import { Rejection, validateRow } from './stages/validate.js';
import { Candle } from './types.js';

export interface PipelineOptions {
  pool: pg.Pool;
  source: string;
  symbol: string;
  interval: string;
  /** Candles of stored history used to warm up indicators (default 100). */
  warmup?: number;
  outlierZThreshold?: number;
  /** Abort without loading if more than this share of rows is invalid (default 5%). */
  maxRejectRate?: number;
  rows?: AsyncIterable<RawRow>;
}

export interface PipelineReport {
  symbol: string;
  interval: string;
  source: string;
  rowsRead: number;
  rowsAccepted: number;
  rejected: { count: number; byReason: Record<string, number>; samples: Rejection[] };
  duplicates: { identical: number; conflicting: string[] };
  quality: QualityReport;
  range: { from: string; to: string } | null;
  warmupCandles: number;
  rowsUpserted: number;
  durationMs: number;
}

export class RejectRateExceededError extends Error {}

/** extract → validate → normalize → quality checks → enrich → load. */
export async function runPipeline(options: PipelineOptions): Promise<PipelineReport> {
  const started = Date.now();
  const { pool, source, symbol, interval } = options;
  const intervalMs = intervalToMs(interval);

  const accepted: Candle[] = [];
  const rejections: Rejection[] = [];
  let rowsRead = 0;
  for await (const row of options.rows ?? readCsv(source)) {
    rowsRead++;
    const result = validateRow(row, intervalMs);
    if (result.ok) accepted.push(result.candle);
    else rejections.push({ line: result.line, reason: result.reason });
  }

  const maxRejectRate = options.maxRejectRate ?? 0.05;
  if (rowsRead > 0 && rejections.length / rowsRead > maxRejectRate) {
    throw new RejectRateExceededError(
      `${rejections.length} of ${rowsRead} rows are invalid; refusing to load (limit ${maxRejectRate * 100}%)`,
    );
  }

  const { candles, identicalDuplicates, conflictingDuplicates } = normalize(accepted);
  const quality = checkQuality(candles, intervalMs, { zThreshold: options.outlierZThreshold });

  const warmup =
    candles.length > 0
      ? await loadWarmup(pool, symbol, interval, candles[0]!.openTime, options.warmup ?? 100)
      : [];
  const enriched = enrich([...warmup, ...candles]).slice(warmup.length);

  const client = await pool.connect();
  let rowsUpserted = 0;
  const report = (): PipelineReport => ({
    symbol,
    interval,
    source,
    rowsRead,
    rowsAccepted: accepted.length,
    rejected: {
      count: rejections.length,
      byReason: rejections.reduce<Record<string, number>>((acc, r) => {
        acc[r.reason] = (acc[r.reason] ?? 0) + 1;
        return acc;
      }, {}),
      samples: rejections.slice(0, 10),
    },
    duplicates: {
      identical: identicalDuplicates,
      conflicting: conflictingDuplicates.map((t) => new Date(t).toISOString()),
    },
    quality,
    range: candles.length
      ? {
          from: new Date(candles[0]!.openTime).toISOString(),
          to: new Date(candles[candles.length - 1]!.openTime).toISOString(),
        }
      : null,
    warmupCandles: warmup.length,
    rowsUpserted,
    durationMs: Date.now() - started,
  });

  try {
    // Candles and the run report are committed together.
    await client.query('BEGIN');
    rowsUpserted = await upsertCandles(client, symbol, interval, enriched);
    const result = report();
    await client.query(
      `INSERT INTO pipeline_runs (symbol, interval, source, started_at, report)
       VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), $5)`,
      [symbol, interval, source, started, JSON.stringify(result)],
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
