import Link from "next/link";
import { getLatestSignals } from "../../lib/db";
import { buildRecommendations } from "../../lib/recommendations";

export const dynamic = "force-dynamic";

function shortSymbol(tvSymbol: string): string {
  const i = tvSymbol.indexOf(":");
  return i > -1 ? tvSymbol.slice(i + 1) : tvSymbol;
}

function tvChartUrl(symbol: string): string {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
}

function f2(v: number): string {
  return v.toFixed(2);
}

function fPct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function f01(v: number): string {
  return v.toFixed(2);
}

export default async function RecommendationPage() {
  const signals = await getLatestSignals(10000, "weekly");
  const recommendations = buildRecommendations(signals, 120, 35);
  const top5 = recommendations.slice(0, 5);

  const buyRows = signals.filter((s) => String(s.signal || "").toUpperCase() === "BUY");
  const completeBuyRows = buyRows.filter((s) => s.price != null && s.signal_price != null && s.bars_ago != null);
  const coverage = buyRows.length ? (completeBuyRows.length / buyRows.length) * 100 : 0;
  const inferredRows = recommendations.filter((r) => r.data_quality === "inferred").length;

  return (
    <main className="container">
      <section className="hero">
        <div>
          <h1 className="title">AllTickers Multi-Factor Recommendations</h1>
          <p className="sub">BUY-only ranking from weighted factors with data-quality safeguards.</p>
        </div>
        <div className="meta">
          <Link href="/">Scanner Table</Link>
        </div>
      </section>

      <section className="kpis">
        <div className="kpi">
          <div className="label">Rows Ranked</div>
          <div className="value">{recommendations.length}</div>
        </div>
        <div className="kpi">
          <div className="label">Top Score</div>
          <div className="value" style={{ color: "var(--buy)" }}>{top5[0]?.score?.toFixed(2) ?? "-"}</div>
        </div>
        <div className="kpi">
          <div className="label">BUY Data Coverage</div>
          <div className="value">{coverage.toFixed(1)}%</div>
        </div>
        <div className="kpi">
          <div className="label">Inferred in Rank</div>
          <div className="value">{inferredRows}</div>
        </div>
      </section>

      <section className="panel table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th colSpan={10}>Top 5 Recommendations</th>
            </tr>
            <tr>
              <th>Rank</th>
              <th>Symbol</th>
              <th>Name</th>
              <th>Score</th>
              <th>Quality</th>
              <th>Candles Ago</th>
              <th>% Change</th>
              <th>Signal Price</th>
              <th>Current Price</th>
              <th>TV</th>
            </tr>
          </thead>
          <tbody>
            {top5.map((r) => (
              <tr key={`${r.symbol}-${r.ranking}`}>
                <td>{r.ranking}</td>
                <td>{shortSymbol(r.symbol)}</td>
                <td>{r.symbol_name || shortSymbol(r.symbol)}</td>
                <td>{r.score.toFixed(2)}</td>
                <td>{r.data_quality}</td>
                <td>{r.candles_ago}</td>
                <td>{fPct(r.pct_change)}</td>
                <td>{f2(r.signal_price)}</td>
                <td>{f2(r.current_price)}</td>
                <td><a className="tv-link" href={tvChartUrl(r.symbol)} target="_blank" rel="noreferrer">Open</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th colSpan={15}>Full Multi-Factor Rank</th>
            </tr>
            <tr>
              <th>Rank</th>
              <th>Symbol</th>
              <th>Market</th>
              <th>Score</th>
              <th>Quality</th>
              <th>Recency</th>
              <th>Momentum</th>
              <th>Entry</th>
              <th>Freshness</th>
              <th>Market Q</th>
              <th>Candles</th>
              <th>% Change</th>
              <th>Signal Price</th>
              <th>Current Price</th>
              <th>TV</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map((r) => (
              <tr key={`${r.symbol}-${r.ranking}-${r.ts}`}>
                <td>{r.ranking}</td>
                <td>{shortSymbol(r.symbol)}</td>
                <td>{r.market}</td>
                <td>{r.score.toFixed(2)}</td>
                <td>{r.data_quality}</td>
                <td>{f01(r.recency_factor)}</td>
                <td>{f01(r.momentum_factor)}</td>
                <td>{f01(r.entry_factor)}</td>
                <td>{f01(r.freshness_factor)}</td>
                <td>{f01(r.market_factor)}</td>
                <td>{r.candles_ago}</td>
                <td>{fPct(r.pct_change)}</td>
                <td>{f2(r.signal_price)}</td>
                <td>{f2(r.current_price)}</td>
                <td><a className="tv-link" href={tvChartUrl(r.symbol)} target="_blank" rel="noreferrer">Open</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
