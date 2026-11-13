const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 } as const;

/** Parses intervals such as `1m`, `15m`, `4h` or `1d` into milliseconds. */
export function intervalToMs(interval: string): number {
  const match = /^(\d+)([mhdw])$/.exec(interval);
  if (!match) throw new Error(`Unsupported interval "${interval}" (expected e.g. 1m, 1h, 1d)`);
  const value = Number(match[1]);
  if (value <= 0) throw new Error(`Interval must be positive: "${interval}"`);
  return value * UNIT_MS[match[2] as keyof typeof UNIT_MS];
}
