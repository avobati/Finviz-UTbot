import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runUtScan } from "core";
import { beginRun, finishRun, upsertSignal } from "db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../..");
const groupsPath = path.join(root, "config", "groups.json");

function getArg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const groupId = Number(getArg("group", "1"));
const timeframe = process.env.SCAN_TIMEFRAME || "weekly";

const groups = JSON.parse(fs.readFileSync(groupsPath, "utf8"));
const selected = groups.find((g) => g.groupId === groupId);

if (!selected) {
  throw new Error(`Group ${groupId} not found in config/groups.json`);
}

const run = await beginRun(groupId, timeframe);

try {
  let failures = 0;

  for (const symbol of selected.symbols) {
    const scanTs = new Date().toISOString();

    try {
      const res = await runUtScan({ symbol, timeframe });
      await upsertSignal({
        symbol,
        timeframe,
        signal: res.signal,
        price: res.price,
        signalPrice: res.signalPrice,
        barsAgo: res.barsAgo,
        // Always stamp with the actual scan run time for freshness/ranking reliability.
        ts: scanTs,
        runId: run.id
      });
    } catch (err) {
      failures += 1;
      await upsertSignal({
        symbol,
        timeframe,
        signal: "NEUTRAL",
        price: null,
        signalPrice: null,
        barsAgo: null,
        ts: scanTs,
        runId: run.id
      });
      console.error(`scan-failed symbol=${symbol} err=${String(err)}`);
    }
  }

  await finishRun(run.id, "success", null);
  console.log(`Group ${groupId} completed: ${selected.symbols.length} symbols, failures=${failures}`);
} catch (error) {
  await finishRun(run.id, "failed", String(error));
  throw error;
}
