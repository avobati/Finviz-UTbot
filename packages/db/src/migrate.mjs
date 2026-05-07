import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const { Client } = pg;
const dbUrl = (process.env.DATABASE_URL || "").trim();

if (!dbUrl) {
  throw new Error("DATABASE_URL is required for migration");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.join(__dirname, "..", "schema.sql");
const sql = fs.readFileSync(schemaPath, "utf8");

const client = new Client({ connectionString: dbUrl.replace(/([?&]sslmode=)require\b/i, "$1verify-full") });
await client.connect();
try {
  await client.query(sql);
  console.log("DB migration complete");
} finally {
  await client.end();
}
