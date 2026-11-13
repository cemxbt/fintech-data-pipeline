export interface Candle {
  /** Start of the candle, in milliseconds since the Unix epoch (UTC). */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /**
   * The original decimal strings. Prices are loaded into NUMERIC columns from these, so no
   * precision is lost to binary floating point; the numbers are used for indicator maths.
   */
  raw: { open: string; high: string; low: string; close: string; volume: string };
}

export interface Indicators {
  sma20: number | null;
  ema12: number | null;
  ema26: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  bbUpper: number | null;
  bbLower: number | null;
  vwap: number | null;
}

export type EnrichedCandle = Candle & Indicators;
