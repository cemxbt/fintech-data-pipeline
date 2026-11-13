import { Candle } from '../types.js';

export interface NormalizeResult {
  candles: Candle[];
  identicalDuplicates: number;
  /** Timestamps that appeared more than once with different values; the last one wins. */
  conflictingDuplicates: number[];
}

const sameValues = (a: Candle, b: Candle) =>
  a.raw.open === b.raw.open &&
  a.raw.high === b.raw.high &&
  a.raw.low === b.raw.low &&
  a.raw.close === b.raw.close &&
  a.raw.volume === b.raw.volume;

/**
 * Sorts candles by time and removes duplicates. When a timestamp repeats with different
 * values, the later row is kept: exchange exports append corrections rather than rewrite.
 */
export function normalize(candles: Candle[]): NormalizeResult {
  const byTime = new Map<number, Candle>();
  let identicalDuplicates = 0;
  const conflicts = new Set<number>();

  for (const candle of candles) {
    const existing = byTime.get(candle.openTime);
    if (existing) {
      if (sameValues(existing, candle)) identicalDuplicates++;
      else conflicts.add(candle.openTime);
    }
    byTime.set(candle.openTime, candle);
  }

  return {
    candles: [...byTime.values()].sort((a, b) => a.openTime - b.openTime),
    identicalDuplicates,
    conflictingDuplicates: [...conflicts].sort((a, b) => a - b),
  };
}
