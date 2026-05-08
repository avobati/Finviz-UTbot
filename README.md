# Finviz UTbot - Stocks and ETF (Vercel + Worker + DB)

This app is copied from `avobati/Weeklytop5` and keeps the original scanner untouched.

## Goal
- Reuse the same UT logic in a new deployable architecture.
- Scan the ticker universe imported from the Finviz screener workbook.
- Run scans in 50 groups on a 24-hour cadence.
- Deploy UI/API on Vercel.
- Keep monthly cost near zero with free-tier defaults.

## Architecture
- `apps/web`: Next.js app for dashboard + read-only API routes (deploy to Vercel).
- `apps/worker`: Node worker that scans one group at a time (run via GitHub Actions schedule).
- `apps/worker/src/ut_logic.py`: embedded UT algorithm (ported from your existing app logic).
- `packages/core`: adapter that calls Python bridge and returns `BUY|SELL|NEUTRAL`.
- `packages/db`: DB schema + queries (Postgres, Neon/Supabase free tier).
- `config`: Finviz ticker universe, group mapping, strategy, provider map.

## Quick Start
1. `pnpm install`
2. Copy `.env.example` to `.env` and set values.
3. Import/update Finviz tickers: `python scripts/import-finviz-tickers.py C:\Users\avoba\Downloads\finviz_all_tickers.xlsx`
4. Build groups: `pnpm gen:groups`
5. Update local signals snapshot: `pnpm update:signals`
6. Apply DB schema: `pnpm db:migrate`
7. Seed the latest 11,056 signal rows into Postgres: `pnpm db:seed`
8. Local worker test: `pnpm worker -- --group 1`
9. Run web app: `pnpm web`

## Local Signal Snapshot
When `DATABASE_URL` is not configured, the web app reads `apps/web/data/latest_signals.json`.
Refresh it with:

```bash
python scripts/update-signals-snapshot.py --timeframe weekly --workers 24
```

## Deploy
1. Push this repo to GitHub.
2. Import `apps/web` in Vercel as a project.
3. Add `DATABASE_URL` in Vercel.
4. Enable GitHub Actions workflow for scheduled scans.
5. Add GitHub secrets:
   - `DATABASE_URL`
   - `SCAN_TIMEFRAME` (`daily`, `weekly`, or `monthly`)

## Notes
- Current scaffold is set for daily scans to minimize cost.
- If your symbol is `BINANCE:BTCUSDT`, bridge normalizes it and can map it via `config/provider_map.json`.
