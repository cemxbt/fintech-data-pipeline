import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { withTransaction } from './db.js';

const LOCK_ID = 7_351_904;

/** Applies `*.sql` files in name order, once each. Safe to run from several processes. */
export async function migrate(pool: pg.Pool, directory: string): Promise<string[]> {
  return withTransaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(directory)).filter((f) => f.endsWith('.sql')).sort();

    const newlyApplied: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query(await readFile(join(directory, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      newlyApplied.push(file);
    }
    return newlyApplied;
  });
}
