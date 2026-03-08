export type SignalInput = {
  symbol: string;
  symbol_name: string;
  market: string;
  timeframe: string;
  signal: string;
  price: number | string | null;
  signal_price: number | string | null;
  bars_ago: number | null;
  ts: string;
  data_quality?: "complete" | "inferred" | "missing";
};

export type Recommendation = {
  symbol: string;
  symbol_name: string;
  market: string;
  timeframe: string;
  signal: "BUY";
  candles_ago: number;
  signal_price: number;
  current_price: number;
  change: number;
  pct_change: number;
  recency_factor: number;
  momentum_factor: number;
  entry_factor: number;
  freshness_factor: number;
  market_factor: number;
  quality_factor: number;
  data_quality: "complete" | "inferred" | "missing";
  score: number;
  ranking: number;
  ts: string;
};

function toNumber(v: number | string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toCandlesAgo(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  return n >= 0 ? n : null;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function recencyFactor(candlesAgo: number): number {
  return clamp01(Math.exp(-candlesAgo / 6));
}

function momentumFactor(pctChange: number): number {
  const x = pctChange * 10;
  return clamp01(1 / (1 + Math.exp(-x)));
}

function entryFactor(pctChange: number): number {
  return clamp01(1 - Math.min(Math.abs(pctChange) / 0.25, 1));
}

function freshnessFactor(ts: string): number {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return 0.4;
  const ageDays = (Date.now() - ms) / 86400000;
  if (ageDays <= 1) return 1;
  if (ageDays <= 3) return 0.8;
  if (ageDays <= 7) return 0.6;
  if (ageDays <= 14) return 0.45;
  return 0.3;
}

function marketFactor(market: string): number {
  const m = String(market || "").trim().toUpperCase();
  if (m === "NASDAQ" || m === "NYSE") return 1;
  if (m === "NYSEARCA" || m === "AMEX") return 0.85;
  if (m === "BATS") return 0.75;
  return 0.65;
}

function dataQualityFactor(q: "complete" | "inferred" | "missing"): number {
  if (q === "complete") return 1;
  if (q === "inferred") return 0.8;
  return 0.4;
}

function weightedScore(parts: {
  recency: number;
  momentum: number;
  entry: number;
  freshness: number;
  market: number;
  quality: number;
}): number {
  const wRecency = 0.27;
  const wMomentum = 0.23;
  const wEntry = 0.18;
  const wFreshness = 0.12;
  const wMarket = 0.08;
  const wQuality = 0.12;
  const raw =
    parts.recency * wRecency +
    parts.momentum * wMomentum +
    parts.entry * wEntry +
    parts.freshness * wFreshness +
    parts.market * wMarket +
    parts.quality * wQuality;
  return Math.round(raw * 10000) / 100;
}

export function buildRecommendations(signals: SignalInput[], topK = 100, minScore = 35): Recommendation[] {
  const out: Recommendation[] = [];

  for (const row of signals) {
    const signal = String(row.signal || "").trim().toUpperCase();
    if (signal !== "BUY") continue;

    const candles = toCandlesAgo(row.bars_ago);
    const signalPrice = toNumber(row.signal_price);
    const currentPrice = toNumber(row.price);
    if (candles == null || signalPrice == null || currentPrice == null || signalPrice <= 0) continue;

    const change = currentPrice - signalPrice;
    const pct = change / signalPrice;
    const quality = row.data_quality || "complete";

    const recency = recencyFactor(candles);
    const momentum = momentumFactor(pct);
    const entry = entryFactor(pct);
    const fresh = freshnessFactor(row.ts);
    const mkt = marketFactor(row.market);
    const qf = dataQualityFactor(quality);
    const score = weightedScore({ recency, momentum, entry, freshness: fresh, market: mkt, quality: qf });
    if (score < minScore) continue;

    out.push({
      symbol: row.symbol,
      symbol_name: row.symbol_name,
      market: row.market || "UNKNOWN",
      timeframe: row.timeframe,
      signal: "BUY",
      candles_ago: candles,
      signal_price: signalPrice,
      current_price: currentPrice,
      change,
      pct_change: pct,
      recency_factor: recency,
      momentum_factor: momentum,
      entry_factor: entry,
      freshness_factor: fresh,
      market_factor: mkt,
      quality_factor: qf,
      data_quality: quality,
      score,
      ranking: 0,
      ts: row.ts,
    });
  }

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.quality_factor !== a.quality_factor) return b.quality_factor - a.quality_factor;
    if (b.momentum_factor !== a.momentum_factor) return b.momentum_factor - a.momentum_factor;
    if (a.candles_ago !== b.candles_ago) return a.candles_ago - b.candles_ago;
    return a.symbol.localeCompare(b.symbol);
  });

  const cap = Math.max(1, topK);
  const sliced = out.slice(0, cap);
  for (let i = 0; i < sliced.length; i += 1) {
    sliced[i].ranking = i + 1;
  }

  return sliced;
}
