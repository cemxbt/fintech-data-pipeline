CREATE TABLE IF NOT EXISTS candles (
    symbol      text          NOT NULL,
    interval    text          NOT NULL,
    open_time   timestamptz   NOT NULL,
    open        numeric(20,8) NOT NULL,
    high        numeric(20,8) NOT NULL,
    low         numeric(20,8) NOT NULL,
    close       numeric(20,8) NOT NULL,
    volume      numeric(28,8) NOT NULL,
    sma_20      double precision,
    ema_12      double precision,
    ema_26      double precision,
    rsi_14      double precision,
    macd        double precision,
    macd_signal double precision,
    bb_upper    double precision,
    bb_lower    double precision,
    vwap        double precision,
    ingested_at timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (symbol, interval, open_time),
    CHECK (high >= low AND high >= open AND high >= close AND low <= open AND low <= close),
    CHECK (volume >= 0)
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol      text        NOT NULL,
    interval    text        NOT NULL,
    source      text        NOT NULL,
    started_at  timestamptz NOT NULL,
    finished_at timestamptz NOT NULL DEFAULT now(),
    report      jsonb       NOT NULL
);
