import { getLatestSignals } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const timeframe = searchParams.get("timeframe") || "weekly";
  const limit = Number(searchParams.get("limit") || "0");
  const items = await getLatestSignals(limit, timeframe);
  return Response.json({ ok: true, timeframe, count: items.length, items });
}
