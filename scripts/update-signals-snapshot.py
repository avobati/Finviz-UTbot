from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKER_SRC = ROOT / "apps" / "worker" / "src"
sys.path.insert(0, str(WORKER_SRC))

from ut_logic import aggregate_timeframe, fetch_yahoo_daily, ut_bot_alerts  # noqa: E402


def load_json(path: Path, fallback: dict) -> dict:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8-sig"))


def state_from_tf(tf_data: dict) -> str:
    buy_recent = bool(tf_data.get("buy_recent", False))
    sell_recent = bool(tf_data.get("sell_recent", False))
    if not buy_recent and not sell_recent:
        return "NEUTRAL"
    if buy_recent and not sell_recent:
        return "BUY"
    if sell_recent and not buy_recent:
        return "SELL"

    bars_since_buy = tf_data.get("bars_since_buy")
    bars_since_sell = tf_data.get("bars_since_sell")
    if bars_since_buy is None and bars_since_sell is None:
        return "NEUTRAL"
    if bars_since_buy is None:
        return "SELL"
    if bars_since_sell is None:
        return "BUY"
    if bars_since_buy < bars_since_sell:
        return "BUY"
    if bars_since_sell < bars_since_buy:
        return "SELL"
    return "NEUTRAL"


def signal_metrics(signal: str, tf_data: dict) -> tuple[int | None, float | None]:
    if signal == "BUY":
        px = tf_data.get("last_buy_price")
        return tf_data.get("bars_since_buy"), float(px) if px is not None else None
    if signal == "SELL":
        px = tf_data.get("last_sell_price")
        return tf_data.get("bars_since_sell"), float(px) if px is not None else None

    b_buy = tf_data.get("bars_since_buy")
    b_sell = tf_data.get("bars_since_sell")
    if b_buy is None and b_sell is None:
        return None, None
    if b_buy is None:
        px = tf_data.get("last_sell_price")
        return b_sell, float(px) if px is not None else None
    if b_sell is None:
        px = tf_data.get("last_buy_price")
        return b_buy, float(px) if px is not None else None
    if b_buy <= b_sell:
        px = tf_data.get("last_buy_price")
        return b_buy, float(px) if px is not None else None
    px = tf_data.get("last_sell_price")
    return b_sell, float(px) if px is not None else None


def scan_symbol(symbol: str, timeframe: str, strategy: dict, provider_map: dict[str, str]) -> dict:
    scan_ts = datetime.now(timezone.utc).isoformat()
    try:
        key_value = float(strategy.get("key_value", 2))
        atr_period = int(strategy.get("atr_period", 6))
        lookbacks = strategy.get("lookback_candles", {"daily": 180, "weekly": 24, "monthly": 6})
        lookback = int(lookbacks.get(timeframe, 3))
        provider_symbol = provider_map.get(symbol.upper(), symbol)

        raw = fetch_yahoo_daily(provider_symbol, range_name="10y", retries=2)
        candles = raw if timeframe == "daily" else aggregate_timeframe(raw, timeframe)
        tf_data = ut_bot_alerts(candles, key_value, atr_period, lookback)
        signal = state_from_tf(tf_data)
        bars_ago, signal_price = signal_metrics(signal, tf_data)
        close_price = float(tf_data.get("close", 0.0)) if tf_data.get("close") is not None else None

        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "signal": signal,
            "price": close_price,
            "signal_price": signal_price if signal_price is not None else close_price,
            "bars_ago": bars_ago if bars_ago is not None else 0,
            "ts": scan_ts,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "signal": "NEUTRAL",
            "price": None,
            "signal_price": None,
            "bars_ago": None,
            "ts": scan_ts,
            "error": str(exc),
        }


def write_snapshot(path: Path, timeframe: str, rows: list[dict]) -> None:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "timeframe": timeframe,
        "count": len(rows),
        "items": rows,
    }
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--timeframe", default="weekly", choices=["daily", "weekly", "monthly"])
    parser.add_argument("--workers", type=int, default=16)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--checkpoint", type=int, default=250)
    args = parser.parse_args()

    symbols = [
        line.strip().upper()
        for line in (ROOT / "config" / "tickers.csv").read_text(encoding="utf-8-sig").splitlines()
        if line.strip() and not line.strip().startswith("#")
    ]
    if args.limit > 0:
        symbols = symbols[: args.limit]

    strategy = load_json(ROOT / "config" / "strategy.json", {})
    provider_map = load_json(ROOT / "config" / "provider_map.json", {})
    snapshot_path = ROOT / "apps" / "web" / "data" / "latest_signals.json"

    rows: list[dict] = []
    started = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {
            executor.submit(scan_symbol, symbol, args.timeframe, strategy, provider_map): symbol
            for symbol in symbols
        }
        for index, future in enumerate(as_completed(futures), start=1):
            rows.append(future.result())
            if index % args.checkpoint == 0 or index == len(symbols):
                rows.sort(key=lambda row: row["symbol"])
                write_snapshot(snapshot_path, args.timeframe, rows)
                elapsed = time.time() - started
                print(f"scanned={index}/{len(symbols)} elapsed={elapsed:.1f}s")

    rows.sort(key=lambda row: row["symbol"])
    write_snapshot(snapshot_path, args.timeframe, rows)
    failures = sum(1 for row in rows if row.get("error"))
    counts = {name: sum(1 for row in rows if row["signal"] == name) for name in ["BUY", "SELL", "NEUTRAL"]}
    print(f"updated {len(rows)} signals: {counts}, failures={failures}")


if __name__ == "__main__":
    main()
