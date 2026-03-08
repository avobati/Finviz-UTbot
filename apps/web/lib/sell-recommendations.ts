import type { SignalInput } from "./recommendations";

export type SellRecommendation = {
  symbol: string;
  symbol_name: string;
  market: string;
  timeframe: string;
  signal: "SELL";
  candles_ago: number;
  signal_price: number;
  current_price: number;
  change: number;
  pct_change: number;
  recency_factor: number;
  downside_momentum_factor: number;
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

function downsideMomentumFactor(pctChange: number): number {
  // For SELL ranking, stronger negative move is better.
  const x = -pctChange * 10;
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
  downsideMomentum: number;
  entry: number;
  freshness: number;
  market: number;
  quality: number;
}): number {
  const wRecency = 0.27;
  const wDownsideMomentum = 0.23;
  const wEntry = 0.18;
  const wFreshness = 0.12;
  const wMarket = 0.08;
  const wQuality = 0.12;

  const raw =
    parts.recency * wRecency +
    parts.downsideMomentum * wDownsideMomentum +
    parts.entry * wEntry +
    parts.freshness * wFreshness +
    parts.market * wMarket +
    parts.quality * wQuality;

  return Math.round(raw * 10000) / 100;
}

export function buildSellRecommendations(signals: SignalInput[], topK = 100, minScore = 35): SellRecommendation[] {
  const out: SellRecommendation[] = [];

  for (const row of signals) {
    const signal = String(row.signal || "").trim().toUpperCase();
    if (signal !== "SELL") continue;

    const candles = toCandlesAgo(row.bars_ago);
    const signalPrice = toNumber(row.signal_price);
    const currentPrice = toNumber(row.price);
    if (candles == null || signalPrice == null || currentPrice == null || signalPrice <= 0) continue;

    const change = currentPrice - signalPrice;
    const pct = change / signalPrice;
    const quality = row.data_quality || "complete";

    const recency = recencyFactor(candles);
    const downsideMomentum = downsideMomentumFactor(pct);
    const entry = entryFactor(pct);
    const fresh = freshnessFactor(row.ts);
    const mkt = marketFactor(row.market);
    const qf = dataQualityFactor(quality);
    const score = weightedScore({ recency, downsideMomentum, entry, freshness: fresh, market: mkt, quality: qf });
    if (score < minScore) continue;

    out.push({
      symbol: row.symbol,
      symbol_name: row.symbol_name,
      market: row.market || "UNKNOWN",
      timeframe: row.timeframe,
      signal: "SELL",
      candles_ago: candles,
      signal_price: signalPrice,
      current_price: currentPrice,
      change,
      pct_change: pct,
      recency_factor: recency,
      downside_momentum_factor: downsideMomentum,
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
    if (b.downside_momentum_factor !== a.downside_momentum_factor) return b.downside_momentum_factor - a.downside_momentum_factor;
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
