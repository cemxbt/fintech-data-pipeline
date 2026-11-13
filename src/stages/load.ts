import pg from 'pg';
import { Candle, EnrichedCandle } from '../types.js';

const BATCH_SIZE = 1_000;

/**
 * Upserts candles keyed by (symbol, interval, open_time). Re-running the pipeline on the
 * same file, or on overlapping files, therefore never creates duplicates and applies
 * corrections in place. Rows are sent as arrays and expanded with `unnest`, so a batch
 * of a thousand candles is a single round trip.
 */
export async function upsertCandles(
  db: pg.Pool | pg.PoolClient,
  symbol: string,
  interval: string,
  candles: EnrichedCandle[],
): Promise<number> {
  let written = 0;
  for (let i = 0; i < candles.length; i += BATCH_SIZE) {
    const batch = candles.slice(i, i + BATCH_SIZE);
    const column = <T>(pick: (c: EnrichedCandle) => T) => batch.map(pick);
    const result = await db.query(
      `INSERT INTO candles (symbol, interval, open_time, open, high, low, close, volume,
                            sma_20, ema_12, ema_26, rsi_14, macd, macd_signal,
                            bb_upper, bb_lower, vwap)
       SELECT $1, $2, to_timestamp(t / 1000.0), o, h, l, c, v,
              sma20, ema12, ema26, rsi14, macd, signal, upper, lower, vwap
         FROM unnest($3::bigint[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[],
                     $8::numeric[], $9::float8[], $10::float8[], $11::float8[], $12::float8[],
                     $13::float8[], $14::float8[], $15::float8[], $16::float8[], $17::float8[])
              AS rows(t, o, h, l, c, v, sma20, ema12, ema26, rsi14, macd, signal, upper, lower, vwap)
       ON CONFLICT (symbol, interval, open_time) DO UPDATE SET
              open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
              close = EXCLUDED.close, volume = EXCLUDED.volume,
              sma_20 = EXCLUDED.sma_20, ema_12 = EXCLUDED.ema_12, ema_26 = EXCLUDED.ema_26,
              rsi_14 = EXCLUDED.rsi_14, macd = EXCLUDED.macd, macd_signal = EXCLUDED.macd_signal,
              bb_upper = EXCLUDED.bb_upper, bb_lower = EXCLUDED.bb_lower, vwap = EXCLUDED.vwap,
              ingested_at = now()`,
      [
        symbol,
        interval,
        column((c) => c.openTime),
        column((c) => c.raw.open),
        column((c) => c.raw.high),
        column((c) => c.raw.low),
        column((c) => c.raw.close),
        column((c) => c.raw.volume),
        column((c) => c.sma20),
        column((c) => c.ema12),
        column((c) => c.ema26),
        column((c) => c.rsi14),
        column((c) => c.macd),
        column((c) => c.macdSignal),
        column((c) => c.bbUpper),
        column((c) => c.bbLower),
        column((c) => c.vwap),
      ],
    );
    written += result.rowCount ?? 0;
  }
  return written;
}

/**
 * Loads the candles stored just before `before`. Indicators such as a 26-period EMA need
 * history, so an incremental run prepends these before computing and does not write them back.
 */
export async function loadWarmup(
  db: pg.Pool | pg.PoolClient,
  symbol: string,
  interval: string,
  before: number,
  count: number,
): Promise<Candle[]> {
  const { rows } = await db.query(
    `SELECT (extract(epoch FROM open_time) * 1000)::bigint AS t,
            open::text, high::text, low::text, close::text, volume::text
       FROM candles
      WHERE symbol = $1 AND interval = $2 AND open_time < to_timestamp($3 / 1000.0)
      ORDER BY open_time DESC
      LIMIT $4`,
    [symbol, interval, before, count],
  );
  return rows.reverse().map((r) => ({
    openTime: Number(r.t),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
    raw: { open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume },
  }));
}
