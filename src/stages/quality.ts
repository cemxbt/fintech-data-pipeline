import { Candle } from '../types.js';

export interface Gap {
  from: string;
  to: string;
  missingCandles: number;
}

export interface Outlier {
  openTime: string;
  logReturn: number;
  zScore: number;
}

export interface QualityReport {
  gaps: Gap[];
  missingCandles: number;
  outliers: Outlier[];
  zeroVolumeCandles: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Finds missing candles and abnormal moves. A move is an outlier when its log return is
 * more than `zThreshold` standard deviations from the mean of the preceding `window` returns,
 * which adapts to each market's normal volatility instead of using a fixed percentage.
 */
export function checkQuality(
  candles: Candle[],
  intervalMs: number,
  { window = 50, zThreshold = 6 } = {},
): QualityReport {
  const gaps: Gap[] = [];
  for (let i = 1; i < candles.length; i++) {
    const missing = (candles[i]!.openTime - candles[i - 1]!.openTime) / intervalMs - 1;
    if (missing >= 1) {
      gaps.push({
        from: iso(candles[i - 1]!.openTime + intervalMs),
        to: iso(candles[i]!.openTime - intervalMs),
        missingCandles: Math.round(missing),
      });
    }
  }

  const returns = candles.slice(1).map((c, i) => Math.log(c.close / candles[i]!.close));
  const outliers: Outlier[] = [];
  for (let i = window; i < returns.length; i++) {
    const history = returns.slice(i - window, i);
    const mean = history.reduce((a, b) => a + b, 0) / window;
    const std = Math.sqrt(history.reduce((a, r) => a + (r - mean) ** 2, 0) / window);
    if (std === 0) continue;
    const z = (returns[i]! - mean) / std;
    if (Math.abs(z) > zThreshold) {
      outliers.push({
        openTime: iso(candles[i + 1]!.openTime),
        logReturn: Number(returns[i]!.toFixed(6)),
        zScore: Number(z.toFixed(2)),
      });
    }
  }

  return {
    gaps,
    missingCandles: gaps.reduce((sum, g) => sum + g.missingCandles, 0),
    outliers,
    zeroVolumeCandles: candles.filter((c) => c.volume === 0).length,
  };
}
