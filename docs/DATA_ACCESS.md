# Data Access Inventory

Last tested: 2026-07-06 (all tests live from this machine).

## Keys present in `.env`

| Key | Status | Test performed |
|---|---|---|
| `EIA_API_KEY` | **WORKING** | Live call to `api.eia.gov/v2/electricity/rto/region-data` returned current ERCOT hourly demand (78,111 MWh @ 2026-07-06T18Z). 40-char key. |
| `VITE_EIA_API_KEY` | present (same key, client-exposed) | Not separately tested. Consider whether client exposure is intended. |

No other keys are set locally. Production (Vercel) may hold more; not verifiable from here.

## Sources needed for Phases 1–3

| Source | Status | Action needed |
|---|---|---|
| **EIA v2** | Working (see above). Hourly demand/generation/interchange by BA, fuel mix. Rate limit: 5,000 rows/req, hourly-friendly. | None. |
| **ERCOT Public API** (`api.ercot.com`) | **MISSING — registration required.** Unauthenticated probe returned HTTP 401. This is the source for settlement point prices (DAM + RTM SPPs), outages, and the 90-day backfill. | **Manual signup (you):** <https://apiexplorer.ercot.com/> → register (free) → subscribe to "Public API" → get subscription key + set password. Lead time: same day (account is instant; API access typically active within minutes). Env vars to add: `ERCOT_API_USERNAME`, `ERCOT_API_PASSWORD`, `ERCOT_SUBSCRIPTION_KEY`. |
| **ERCOT MIS public reports** (`mis.ercot.com`) | Blocked from this host: `GetReports.do` redirects into SiteMinder cert auth; `www.ercot.com` dashboard JSON sits behind Incapsula bot challenge. | Not usable as a reliable backfill path. Public API above is the way. |
| **NOAA api.weather.gov** | **WORKING, no key.** Probe of hourly gridpoint forecast (EWX = Austin/San Antonio CWA) returned HTTP 200. Requires a descriptive `User-Agent` header only. | None for forecasts/observations. Optional: NCEI CDO token for deep historical climate — <https://www.ncdc.noaa.gov/cdo-web/token>, emailed instantly. |
| **PJM Data Miner 2** | **MISSING — stub only this phase.** | **Manual signup (you), when we get to PJM:** <https://apiportal.pjm.com/> (free account, key issued same day). Env var: `PJM_API_KEY`. |
| **MISO** | Stub only this phase. Public JSON endpoints exist without keys. | None yet. |

## Keys needed for Phase 2+ (analyst, alerting, payments)

| Key | Status | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | **MISSING.** | Required for Fable 5 / Sonnet / Haiku via Messages API. Costs money → your call when to add. The ContextPacket builder and contract validator are testable without it. |
| `GROQ_API_KEY` / `OPENROUTER_API_KEY` | Missing locally. | Powers the existing AI Insights panel + chat-analyst in the inherited codebase; those degrade silently without it. Not needed for the new analyst. |
| `RESEND_API_KEY` | Missing locally. | Phase 3 email alerts. Repo already integrates Resend (Convex + notification relay) — reuse instead of SES. |
| Upstash / Convex / Dodo / Clerk | Missing locally. | Inherited stack. Phase 4 decision: repo has Dodo Payments fully wired, prompt says Stripe — flagged in BUILD_PLAN.md. |
