import { getLatestSignals } from "../../../../lib/db";
import { buildSellRecommendations } from "../../../../lib/sell-recommendations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get("timeframe") || "weekly";
  const limit = Number(searchParams.get("limit") || "10000");
  const topK = Number(searchParams.get("topK") || "100");
  const minScore = Number(searchParams.get("minScore") || "35");

  const signals = await getLatestSignals(limit, timeframe);
  const items = buildSellRecommendations(signals, topK, minScore);

  return Response.json({ ok: true, timeframe, count: items.length, topK, minScore, items });
}
