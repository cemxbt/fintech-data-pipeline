/**
 * Technical indicators over a series of closes. Every function returns an array aligned
 * with its input; positions without enough history are `null` rather than a misleading
 * partial value.
 */

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the simple average of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** EMA over a series that starts with nulls (used for the MACD signal line). */
function emaOfSeries(series: Series, period: number): Series {
  const start = series.findIndex((v) => v !== null);
  const out: Series = new Array(series.length).fill(null);
  if (start === -1) return out;
  const tail = ema(series.slice(start) as number[], period);
  tail.forEach((v, i) => (out[start + i] = v));
  return out;
}

/** Relative Strength Index with Wilder's smoothing. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i]! - values[i - 1]!;
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;

  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = value();

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i]! - values[i - 1]!;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    out[i] = value();
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line: Series = values.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null ? fastEma[i]! - slowEma[i]! : null,
  );
  return { fastEma, slowEma, line, signal: emaOfSeries(line, signal) };
}

/** Bollinger Bands using the population standard deviation, as in Bollinger's definition. */
export function bollinger(values: number[], period = 20, width = 2) {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i]!;
    const variance =
      values.slice(i - period + 1, i + 1).reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance) * width;
    upper[i] = mean + deviation;
    lower[i] = mean - deviation;
  }
  return { middle, upper, lower };
}

/** Volume-weighted average price of the typical price, reset at each UTC day. */
export function vwap(
  candles: { openTime: number; high: number; low: number; close: number; volume: number }[],
): Series {
  let day = -1;
  let priceVolume = 0;
  let volume = 0;
  return candles.map((c) => {
    const currentDay = Math.floor(c.openTime / 86_400_000);
    if (currentDay !== day) {
      day = currentDay;
      priceVolume = 0;
      volume = 0;
    }
    priceVolume += ((c.high + c.low + c.close) / 3) * c.volume;
    volume += c.volume;
    return volume === 0 ? null : priceVolume / volume;
  });
}
