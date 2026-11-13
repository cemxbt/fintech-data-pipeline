import 'dotenv/config';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { runPipeline } from '../pipeline.js';

const { values } = parseArgs({
  options: {
    input: { type: 'string', short: 'i' },
    symbol: { type: 'string', short: 's' },
    interval: { type: 'string', default: '1h' },
    'max-reject-rate': { type: 'string', default: '0.05' },
  },
});

if (!values.input || !values.symbol) {
  console.error('Usage: npm run pipeline -- --input <file.csv> --symbol <SYMBOL> [--interval 1h]');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const report = await runPipeline({
    pool,
    source: values.input,
    symbol: values.symbol.toUpperCase(),
    interval: values.interval!,
    maxRejectRate: Number(values['max-reject-rate']),
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
