import { describe, expect, it } from 'vitest';
import { bollinger, ema, macd, rsi, sma, vwap } from '../src/indicators/index.js';

const round = (series: (number | null)[], digits = 2) =>
  series.map((v) => (v === null ? null : Number(v.toFixed(digits))));

describe('sma', () => {
  it('averages a sliding window and pads the warm-up with null', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe('ema', () => {
  it('is seeded with the SMA and then smooths with k = 2 / (n + 1)', () => {
    // k = 0.5: seed (1+2+3)/3 = 2, then 4*0.5 + 2*0.5 = 3, then 5*0.5 + 3*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(ema([10, 10, 10, 20], 3)).toEqual([null, null, 10, 15]);
  });

  it('returns only nulls when the series is shorter than the period', () => {
    expect(ema([1, 2], 3)).toEqual([null, null]);
  });
});

describe('rsi', () => {
  it("matches the published reference values for Wilder's RSI", () => {
    // Reference series and results from the StockCharts ChartSchool RSI calculation example.
    const closes = [
      44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826,
      45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439,
    ];
    expect(round(rsi(closes, 14)).slice(14)).toEqual([70.53, 66.32, 66.55, 69.41, 66.36, 57.97]);
    expect(
      rsi(closes, 14)
        .slice(0, 14)
        .every((v) => v === null),
    ).toBe(true);
  });

  it('is 100 in a market that only rises and 50 in a flat one', () => {
    expect(rsi([1, 2, 3, 4, 5], 3).at(-1)).toBe(100);
    expect(rsi([5, 5, 5, 5, 5], 3).at(-1)).toBe(50);
  });
});

describe('macd', () => {
  it('is the difference of the fast and slow EMAs with a signal EMA on top', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 5 + i * 0.1);
    const { line, signal, fastEma, slowEma } = macd(closes, 12, 26, 9);
    expect(line.findIndex((v) => v !== null)).toBe(25);
    expect(signal.findIndex((v) => v !== null)).toBe(25 + 8);
    expect(line[40]).toBeCloseTo(fastEma[40]! - slowEma[40]!, 10);
  });
});

describe('bollinger', () => {
  it('places bands two population standard deviations around the SMA', () => {
    const { middle, upper, lower } = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
    // mean 5, population standard deviation 2
    expect(middle.at(-1)).toBe(5);
    expect(upper.at(-1)).toBe(9);
    expect(lower.at(-1)).toBe(1);
  });
});

describe('vwap', () => {
  const hour = 3_600_000;
  const candle = (openTime: number, price: number, volume: number) => ({
    openTime,
    high: price,
    low: price,
    close: price,
    volume,
  });

  it('weights the typical price by volume and resets at each UTC day', () => {
    const dayStart = Date.UTC(2026, 0, 1);
    const result = vwap([
      candle(dayStart, 10, 1),
      candle(dayStart + hour, 20, 3),
      candle(dayStart + 24 * hour, 50, 2),
    ]);
    expect(result).toEqual([10, 17.5, 50]);
  });
});
