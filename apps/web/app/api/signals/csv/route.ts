import { getLatestSignals } from "../../../../lib/db";

export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "symbol",
  "symbol_name",
  "market",
  "timeframe",
  "signal",
  "candles_ago",
  "signal_price",
  "current_price",
  "updated_at",
  "data_quality",
] as const;

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get("timeframe") || "weekly";
  const rows = await getLatestSignals(0, timeframe);
  const csvRows = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) =>
      [
        row.symbol,
        row.symbol_name,
        row.market,
        row.timeframe,
        row.signal,
        row.bars_ago,
        row.signal_price,
        row.price,
        row.ts,
        row.data_quality,
      ]
        .map(csvCell)
        .join(",")
    ),
  ];

  return new Response(csvRows.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="finviz-utbot-${timeframe}-signals.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
