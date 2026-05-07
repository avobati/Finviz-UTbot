import { Pool } from "pg";
import universe from "../data/universe.json";
import symbolMeta from "../data/symbol_meta.json";
import manualBackfill from "../data/manual_backfill.json";
import latestSignals from "../data/latest_signals.json";

type SignalRow = {
  symbol: string;
  symbol_name: string;
  market: string;
  timeframe: string;
  signal: string;
  price: string | number | null;
  signal_price: string | number | null;
  bars_ago: number | null;
  ts: string;
  data_quality: "complete" | "inferred" | "missing";
};

type BaseSignalRow = Omit<SignalRow, "symbol_name" | "market" | "data_quality">;
type UniverseFile = { symbols?: string[] };
type MetaEntry = { name?: string; market?: string };
type BackfillEntry = {
  timeframe?: string;
  signal?: string;
  price?: string | number | null;
  signal_price?: string | number | null;
  bars_ago?: number | null;
};
type LatestSignalsFile = { items?: BaseSignalRow[] };

const rawDatabaseUrl = (process.env.DATABASE_URL || "").trim();
const hasPlaceholderDbUrl = /user:pass@host/.test(rawDatabaseUrl);
const useNoDbMode = !rawDatabaseUrl || hasPlaceholderDbUrl;
const pool = useNoDbMode ? null : new Pool({ connectionString: rawDatabaseUrl });

const meta = symbolMeta as Record<string, MetaEntry>;
const backfill = manualBackfill as Record<string, BackfillEntry>;
const snapshotRows = (latestSignals as LatestSignalsFile).items || [];
const snapshot = new Map<string, BaseSignalRow>();
for (const row of snapshotRows) {
  snapshot.set(`${String(row.symbol).toUpperCase()}|${String(row.timeframe || "weekly").toLowerCase()}`, row);
}

function metaFor(symbol: string): { symbol_name: string; market: string } {
  const entry = meta[symbol] || {};
  const market = entry.market || (symbol.includes(":") ? symbol.split(":", 1)[0] : "UNKNOWN");
  const fallbackName = symbol.includes(":") ? symbol.split(":", 2)[1] : symbol;
  return {
    symbol_name: entry.name || fallbackName,
    market,
  };
}

function loadUniverse(): string[] {
  const parsed = universe as UniverseFile;
  const symbols = Array.isArray(parsed.symbols) ? parsed.symbols : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const s of symbols) {
    const tv = String(s || "").trim().toUpperCase();
    if (!tv || tv.includes("SPARE")) continue;
    if (seen.has(tv)) continue;
    seen.add(tv);
    out.push(tv);
  }

  return out;
}

function toFiniteNumber(v: string | number | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function timeframeDays(tf: string): number {
  const t = String(tf || "").trim().toLowerCase();
  if (t === "daily") return 1;
  if (t === "monthly") return 30;
  return 7;
}

function inferMissingFields(row: BaseSignalRow, allowBarsFromTs: boolean): BaseSignalRow {
  let price = toFiniteNumber(row.price);
  let signalPrice = toFiniteNumber(row.signal_price);
  let barsAgo = row.bars_ago;

  if (price == null && signalPrice != null) price = signalPrice;
  if (signalPrice == null && price != null) signalPrice = price;

  if ((barsAgo == null || barsAgo < 0) && allowBarsFromTs) {
    const tsMs = Date.parse(row.ts);
    if (Number.isFinite(tsMs) && tsMs > Date.parse("2000-01-01T00:00:00.000Z")) {
      const ageDays = Math.max(0, (Date.now() - tsMs) / 86400000);
      barsAgo = Math.round(ageDays / timeframeDays(row.timeframe));
    }
  }

  return {
    ...row,
    price,
    signal_price: signalPrice,
    bars_ago: barsAgo ?? null,
  };
}

function classifyDataQuality(before: BaseSignalRow, after: BaseSignalRow): "complete" | "inferred" | "missing" {
  const beforeComplete = before.price != null && before.signal_price != null && before.bars_ago != null;
  const afterComplete = after.price != null && after.signal_price != null && after.bars_ago != null;
  if (beforeComplete) return "complete";
  if (afterComplete) return "inferred";
  return "missing";
}

function applyBackfill(symbol: string, timeframe: string, row: BaseSignalRow): BaseSignalRow {
  const b = backfill[symbol];
  if (!b) return row;
  if ((b.timeframe || timeframe).toLowerCase() !== row.timeframe.toLowerCase()) return row;

  const needsBackfill = row.price == null || row.signal_price == null || row.bars_ago == null;
  if (!needsBackfill) return row;

  return {
    ...row,
    signal: row.signal || b.signal || "NEUTRAL",
    price: row.price ?? b.price ?? null,
    signal_price: row.signal_price ?? b.signal_price ?? null,
    bars_ago: row.bars_ago ?? b.bars_ago ?? null,
  };
}

function backfillOnly(symbol: string, timeframe: string): BaseSignalRow {
  const b = backfill[symbol];
  if (!b || (b.timeframe || timeframe).toLowerCase() !== timeframe.toLowerCase()) {
    return {
      symbol,
      timeframe,
      signal: "NEUTRAL",
      price: null,
      signal_price: null,
      bars_ago: null,
      ts: new Date(0).toISOString(),
    };
  }

  return {
    symbol,
    timeframe,
    signal: b.signal || "NEUTRAL",
    price: b.price ?? null,
    signal_price: b.signal_price ?? null,
    bars_ago: b.bars_ago ?? null,
    ts: new Date(0).toISOString(),
  };
}

function priorityRank(signal: string): number {
  const value = String(signal || "").toUpperCase();
  if (value === "BUY") return 0;
  if (value === "SELL") return 1;
  return 2;
}

function applyDisplayLimit(rows: SignalRow[], limit: number): SignalRow[] {
  if (!Number.isFinite(limit) || limit <= 0 || rows.length <= limit) return rows;
  return [...rows]
    .sort((a, b) => {
      const bySignal = priorityRank(a.signal) - priorityRank(b.signal);
      if (bySignal !== 0) return bySignal;
      return a.symbol.localeCompare(b.symbol);
    })
    .slice(0, limit);
}

export async function getLatestSignals(limit = 0, timeframe = "weekly"): Promise<SignalRow[]> {
  const universeSymbols = loadUniverse();
  const cap = Number.isFinite(limit) && limit > 0 ? limit : universeSymbols.length;

  if (!pool) {
    const rows = universeSymbols.map((symbol) => {
      const m = metaFor(symbol);
      const snap = snapshot.get(`${symbol}|${timeframe.toLowerCase()}`);
      const raw = snap ? applyBackfill(symbol, timeframe, snap) : backfillOnly(symbol, timeframe);
      const inferred = inferMissingFields(raw, false);
      return {
        ...inferred,
        data_quality: classifyDataQuality(raw, inferred),
        ...m,
      };
    });
    return applyDisplayLimit(rows, cap);
  }

  const sql = `
    select distinct on (s.symbol, s.timeframe)
      s.symbol, s.timeframe, s.signal, s.price, s.signal_price, s.bars_ago, s.ts
    from signals s
    where s.timeframe = $1
    order by s.symbol, s.timeframe, s.ts desc
  `;

  const result = await pool.query(sql, [timeframe]);
  const latest = new Map<string, BaseSignalRow>();
  for (const r of result.rows as BaseSignalRow[]) {
    latest.set(String(r.symbol).toUpperCase(), r);
  }

  const displayRows = universeSymbols.map((symbol) => {
    const m = metaFor(symbol);
    const row = latest.get(symbol);
    const raw = row ? applyBackfill(symbol, timeframe, row) : backfillOnly(symbol, timeframe);
    const inferred = inferMissingFields(raw, Boolean(row));
    return {
      ...inferred,
      data_quality: classifyDataQuality(raw, inferred),
      ...m,
    };
  });
  return applyDisplayLimit(displayRows, cap);
}
