import { bollinger, ema, macd, rsi, sma, vwap } from '../indicators/index.js';
import { Candle, EnrichedCandle } from '../types.js';

/** Adds indicator columns to every candle. */
export function enrich(candles: Candle[]): EnrichedCandle[] {
  const closes = candles.map((c) => c.close);
  const sma20 = sma(closes, 20);
  const { fastEma, slowEma, line, signal } = macd(closes, 12, 26, 9);
  const rsi14 = rsi(closes, 14);
  const bands = bollinger(closes, 20, 2);
  const vwapSeries = vwap(candles);

  return candles.map((candle, i) => ({
    ...candle,
    sma20: sma20[i] ?? null,
    ema12: fastEma[i] ?? null,
    ema26: slowEma[i] ?? null,
    rsi14: rsi14[i] ?? null,
    macd: line[i] ?? null,
    macdSignal: signal[i] ?? null,
    bbUpper: bands.upper[i] ?? null,
    bbLower: bands.lower[i] ?? null,
    vwap: vwapSeries[i] ?? null,
  }));
}
