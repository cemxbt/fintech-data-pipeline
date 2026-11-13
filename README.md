# Fintech Data Pipeline

[![CI](https://github.com/cemxbt/fintech-data-pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/cemxbt/fintech-data-pipeline/actions/workflows/ci.yml)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

An ingestion pipeline for OHLCV market data (candles). It streams CSV exports, rejects
inconsistent rows, cleans the time series, measures data quality, computes common technical
indicators and loads the result into PostgreSQL — idempotently, so the same file can be
processed any number of times.

```
CSV ─▶ extract ─▶ validate ─▶ normalize ─▶ quality checks ─▶ enrich ─▶ load ─▶ PostgreSQL
       (stream)   (OHLC rules)  (sort, dedupe)  (gaps, outliers)  (indicators)  (upsert + run report)
```

## Features

- **Streaming extraction** of CSV files with flexible headers (`timestamp`, `time`, `open_time`)
  and ISO-8601, epoch-second or epoch-millisecond timestamps
- **Validation** of every row: decimal format, positive prices, non-negative volume,
  `low ≤ open, close ≤ high`, and timestamps aligned to the candle interval
- **A reject-rate circuit breaker** — if too many rows are invalid the run aborts without
  writing anything, instead of silently loading a broken file
- **Normalisation** — sorted output, identical duplicates dropped, conflicting duplicates
  reported (the later row wins, as exchanges append corrections)
- **Data-quality report** — gaps with the exact missing range, and outliers detected as
  log returns more than *z* standard deviations from recent volatility
- **Indicators** — SMA(20), EMA(12/26), RSI(14, Wilder), MACD(12, 26, 9),
  Bollinger Bands(20, 2) and daily-reset VWAP
- **Exact prices** — prices are carried as the original decimal strings into `NUMERIC`
  columns; floating point is used only for indicator maths
- **Idempotent loading** via batched `INSERT … SELECT unnest(…) ON CONFLICT DO UPDATE`
- **Incremental runs** — indicator warm-up history is read from the database, so loading
  a new slice produces the same values as recomputing everything
- **Auditability** — each run stores its full report in `pipeline_runs`, in the same
  transaction as the data

## Quick start

```bash
docker compose up -d
cp .env.example .env
npm install
npm run migrate
npm run pipeline -- --input data/sample/DEMO-1h.csv --symbol DEMO --interval 1h
```

The sample file is **synthetic** (a seeded random walk, regenerated with
`npm run sample-data`), with defects injected on purpose. The run report finds all of them:

```json
{
  "rowsRead": 1440,
  "rowsAccepted": 1438,
  "rejected": {
    "count": 2,
    "byReason": { "high below open/close/low": 1, "invalid timestamp": 1 }
  },
  "duplicates": { "identical": 1, "conflicting": [] },
  "quality": {
    "gaps": [{ "from": "2026-01-17T16:00:00.000Z", "to": "2026-01-17T18:00:00.000Z", "missingCandles": 3 }],
    "outliers": [{ "openTime": "2026-02-07T12:00:00.000Z", "logReturn": 0.249989, "zScore": 33.26 }]
  },
  "rowsUpserted": 1437
}
```

Query the result:

```sql
SELECT open_time, close, rsi_14, macd, macd_signal, bb_upper, bb_lower, vwap
  FROM candles
 WHERE symbol = 'DEMO' AND interval = '1h'
 ORDER BY open_time DESC
 LIMIT 24;
```

## Input format

```csv
timestamp,open,high,low,close,volume
2026-01-01T00:00:00Z,100.00,100.34,98.71,98.98,762.2208
```

Column order does not matter. Exports from most exchanges and data vendors only need their
header renamed.

## Design decisions and trade-offs

- **Validate, then decide.** Invalid rows are counted and sampled rather than failing the run
  at the first error, but a configurable reject rate (5% by default) stops obviously broken
  input from being loaded.
- **Decimal strings for storage, floats for maths.** Prices such as `0.10000001` survive
  ingestion byte for byte. Indicators are statistical estimates, where double precision is
  more than sufficient.
- **Indicators need history.** A 26-period EMA computed from the first row of a new file would
  be wrong for its first stretch; reading recent candles from the database fixes that. The
  test suite verifies that incremental and full runs agree.
- **Adaptive outlier detection.** A fixed "more than 10%" rule is too loose for one market and
  too strict for another; scoring against the trailing volatility adapts to each series.
- **In-memory processing per file.** Extraction streams, but normalisation and indicators
  need the ordered series. This handles years of hourly data comfortably; very large
  histories would be processed in time-windowed chunks with the same warm-up mechanism.

## Project structure

```
src/
├── stages/       extract, validate, normalize, quality, enrich, load
├── indicators/   SMA, EMA, RSI, MACD, Bollinger Bands, VWAP
├── pipeline.ts   orchestration and run report
└── cli/          migrate and run commands
migrations/       candles and pipeline_runs tables
scripts/          reproducible synthetic sample generator
tests/            unit tests and PostgreSQL integration tests
```

## Testing

```bash
docker compose up -d
npm test
```

The indicator tests include the published reference values for Wilder's RSI, and the
integration tests cover the full sample run, idempotency, exact decimal storage, incremental
warm-up and the reject-rate guard.

## License

[MIT](LICENSE)
