import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const { Client } = pg;
const dbUrl = (process.env.DATABASE_URL || "").trim();

if (!dbUrl) {
  throw new Error("DATABASE_URL is required for seeding signals");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../../..");
const snapshotPath = path.join(root, "apps", "web", "data", "latest_signals.json");
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
const rows = Array.isArray(snapshot.items) ? snapshot.items : [];

if (rows.length === 0) {
  throw new Error(`No signal rows found in ${snapshotPath}`);
}

const timeframe = snapshot.timeframe || rows[0]?.timeframe || "weekly";
const groupId = 0;
const runTs = snapshot.generated_at || new Date().toISOString();
const client = new Client({ connectionString: dbUrl });

await client.connect();
try {
  await client.query("begin");
  const run = await client.query(
    `
      insert into scan_runs(group_id, timeframe, status, started_at, finished_at)
      values ($1, $2, 'success', $3, $3)
      returning id
    `,
    [groupId, timeframe, runTs]
  );
  const runId = run.rows[0].id;

  for (const row of rows) {
    await client.query(
      `
        insert into signals(symbol, timeframe, signal, price, signal_price, bars_ago, ts, run_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (symbol, timeframe, ts)
        do update set
          signal = excluded.signal,
          price = excluded.price,
          signal_price = excluded.signal_price,
          bars_ago = excluded.bars_ago,
          run_id = excluded.run_id
      `,
      [
        row.symbol,
        row.timeframe || timeframe,
        row.signal || "NEUTRAL",
        row.price ?? null,
        row.signal_price ?? null,
        row.bars_ago ?? null,
        row.ts || runTs,
        runId,
      ]
    );
  }

  await client.query("commit");
  console.log(`Seeded ${rows.length} signal rows into Postgres`);
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
