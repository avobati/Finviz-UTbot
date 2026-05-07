import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tickersPath = path.join(root, "config", "tickers.csv");
const groupsPath = path.join(root, "config", "groups.json");

const GROUP_COUNT = 50;

function toTvSymbol(input) {
  const s = input.trim().toUpperCase();
  if (!s) return "";
  if (s.includes(":")) return s;
  if (s.endsWith("USDT")) return `BINANCE:${s}`;
  return s;
}

const raw = fs.readFileSync(tickersPath, "utf8");
const symbols = raw
  .split(/\r?\n/)
  .map((x) => toTvSymbol(x))
  .filter(Boolean)
  .filter((x) => !x.startsWith("#"))
  .filter((x) => !x.includes("SPARE"));

const uniqueSymbols = Array.from(new Set(symbols));
if (uniqueSymbols.length === 0) {
  throw new Error("No valid symbols found in config/tickers.csv");
}

const perGroup = Math.ceil(uniqueSymbols.length / GROUP_COUNT);
const groups = [];
for (let i = 0; i < GROUP_COUNT; i += 1) {
  const start = i * perGroup;
  const chunk = uniqueSymbols.slice(start, start + perGroup);
  groups.push({ groupId: i + 1, symbols: chunk });
}

fs.writeFileSync(tickersPath, `${uniqueSymbols.join("\n")}\n`);
fs.writeFileSync(groupsPath, JSON.stringify(groups, null, 2));

console.log(`Generated ${groups.length} groups from ${uniqueSymbols.length} unique tickers (no repeats)`);
