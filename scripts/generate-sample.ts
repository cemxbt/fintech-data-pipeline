/**
 * Generates a synthetic hourly OHLCV file for demos and tests. Prices follow a geometric
 * random walk from a fixed seed, so the output is reproducible. A few defects are injected
 * on purpose so every data-quality check has something to find. This is not market data.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function generateSample({ hours = 24 * 60, seed = 42, start = Date.UTC(2026, 0, 1) } = {}) {
  let state = seed >>> 0;
  const random = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());

  const rows: string[] = ['timestamp,open,high,low,close,volume'];
  let price = 100;
  for (let i = 0; i < hours; i++) {
    const time = start + i * 3_600_000;
    const open = price;
    const shock = i === 900 ? 0.25 : normal() * 0.008; // one abnormal +25% move
    const close = open * Math.exp(shock);
    const high = Math.max(open, close) * (1 + random() * 0.004);
    const low = Math.min(open, close) * (1 - random() * 0.004);
    const volume = 500 + random() * 1500;
    price = close;

    if (i >= 400 && i < 403) continue; // a three-hour gap
    rows.push(
      [new Date(time).toISOString(), open, high, low, close, volume]
        .map((v, k) => (k === 0 ? v : (v as number).toFixed(k === 5 ? 4 : 2)))
        .join(','),
    );
    if (i === 100) rows.push(rows[rows.length - 1]!); // exact duplicate
  }
  rows.splice(200, 0, `${new Date(start + 5 * 3_600_000).toISOString()},101,99,100,100.5,10`); // high < low
  rows.splice(300, 0, 'not-a-date,1,1,1,1,1');
  return rows.join('\n') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = 'data/sample/DEMO-1h.csv';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, generateSample());
  console.log(`Wrote ${path}`);
}
