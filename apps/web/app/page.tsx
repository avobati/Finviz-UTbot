import Link from "next/link";
import { getLatestSignals } from "../lib/db";
import { buildRecommendations } from "../lib/recommendations";
import SignalsTable from "./components/signals-table";

export const dynamic = "force-dynamic";

type Signal = {
  symbol: string;
  symbol_name: string;
  market: string;
  timeframe: string;
  signal: string;
  price: number | string | null;
  signal_price: number | string | null;
  bars_ago: number | null;
  ts: string;
};

function shortSymbol(tvSymbol: string): string {
  const i = tvSymbol.indexOf(":");
  return i > -1 ? tvSymbol.slice(i + 1) : tvSymbol;
}

function tvChartUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function fPct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

export default async function Home() {
  const signals = (await getLatestSignals(10000, "weekly")) as Signal[];
  const recommendations = buildRecommendations(signals, 5, 35);
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || "local";

  const buyCount = signals.filter((s) => s.signal === "BUY").length;
  const sellCount = signals.filter((s) => s.signal === "SELL").length;
  const neutralCount = signals.length - buyCount - sellCount;

  const completeBuyRows = signals.filter(
    (s) => String(s.signal || "").toUpperCase() === "BUY" && s.price != null && s.signal_price != null && s.bars_ago != null
  ).length;
  const buyCoverage = buyCount ? (completeBuyRows / buyCount) * 100 : 0;

  return (
    <main className="container">
      <section className="hero">
        <div>
          <h1 className="title">AllTickers UT Scanner</h1>
          <p className="sub">Weekly scanner + automatic multi-factor recommendations.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="meta">Build {commit.slice(0, 7)}</div>
          <Link className="meta" href="/recommendations">Open Full Recommendation Rank</Link>
        </div>
      </section>

      <section className="kpis">
        <div className="kpi">
          <div className="label">Rows Shown</div>
          <div className="value">{signals.length}</div>
        </div>
        <div className="kpi">
          <div className="label">BUY</div>
          <div className="value" style={{ color: "var(--buy)" }}>{buyCount}</div>
        </div>
        <div className="kpi">
          <div className="label">SELL</div>
          <div className="value" style={{ color: "var(--sell)" }}>{sellCount}</div>
        </div>
        <div className="kpi">
          <div className="label">BUY Coverage</div>
          <div className="value">{buyCoverage.toFixed(1)}%</div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="rec-strip-head">
          <h2>Top 5 Recommendations (Auto)</h2>
          <Link className="meta" href="/recommendations">See All</Link>
        </div>
        <div className="rec-strip-grid">
          {recommendations.map((r) => (
            <article className="rec-strip-card" key={`${r.symbol}-${r.ranking}`}>
              <div className="rec-strip-top">
                <strong>#{r.ranking} {shortSymbol(r.symbol)}</strong>
                <span className="badge buy">{r.score.toFixed(2)}</span>
              </div>
              <div className="rec-strip-name" title={r.symbol_name}>{r.symbol_name || shortSymbol(r.symbol)}</div>
              <div className="rec-strip-metrics">{r.market} | {r.candles_ago} bars | {fPct(r.pct_change)} | {r.data_quality}</div>
              <a className="tv-link" href={tvChartUrl(r.symbol)} target="_blank" rel="noreferrer">Open chart</a>
            </article>
          ))}
        </div>
      </section>

      <SignalsTable rows={signals} />
    </main>
  );
}
