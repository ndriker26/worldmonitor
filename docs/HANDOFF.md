# Handoff — 2026-07-06

## What shipped

1. **Phase 0 complete.** `docs/CODEBASE_MAP.md`, `docs/DATA_ACCESS.md`, `docs/BUILD_PLAN.md`. App runs clean locally (`npm run dev:energy`, verified HTTP 200 — nothing needed fixing). EIA key verified live. Conflicts between the build prompt and the inherited codebase are logged in BUILD_PLAN (Dodo-vs-Stripe, Resend, protected paths, SQLite-local/Postgres-prod).
2. **Phase 1 complete for what's reachable without your ERCOT account.** New `ingestion/` Python service: adapter interface (fetch/validate/normalize/upsert), UTC-everywhere with CPT hour-ending + DSTFlag handling, revision-aware idempotent upserts, per-run heartbeats, schema-drift logging with alias-based parser adaptation, rate-limited backfill. **34 tests pass**, including the three chaos acceptance tests (network kill mid-fetch, corrupt payloads, clock across the 2025-11-02 fall-back; spring-forward gaps are rejected as corrupt rather than silently shifted). **19,328 real observations backfilled**: 90 days of hourly ERCOT demand + generation by fuel from EIA. NOAA adapter live-verified (2,496 forecast rows, 8 load zones). ERCOT SPP adapter (DAM + RTM) is code-complete against the documented Public API, blocked only on credentials.
3. **Phase 2 DoD met.** New `analyst/` service: ContextPacket builder assembled a valid packet **from the real backfilled store** (250k est. tokens, 9 sections, TOC-first, stable-prefix-cacheable). Output contract validator, model router (haiku/sonnet/fable as data), $8 hard-budget abort, notes with falsified-hypothesis-preserving compression, full runner loop. **27 tests pass.** Live Fable runs are code-complete but unexecuted (no API key).

Commits: `f2b16a48` (Phase 0), `0b8c405e` (Phase 1), Phase 2 in the next commit.

## What broke

Nothing left broken. Two things worth knowing:
- ERCOT MIS/dashboard endpoints are bot-walled (SiteMinder/Incapsula) from this machine — the registered Public API is the only viable path.
- The build prompt's "top 20 load zones by volume" doesn't exist — ERCOT has exactly 8 load zones; we track all 8 + all 7 hubs.

## Exact next three tasks

1. **You: register at <https://apiexplorer.ercot.com/>** (free, same-day), then add `ERCOT_API_USERNAME` / `ERCOT_API_PASSWORD` / `ERCOT_SUBSCRIPTION_KEY` to `.env`. Then one command backfills 90 days of DAM+RTM SPPs: `cd ingestion && .venv/Scripts/python -m gridsight.backfill --days 90`.
2. **You: add `ANTHROPIC_API_KEY` to `.env`** (costs money — your call). Then run the first live daily brief and start the scorecard burn-in: `cd analyst && ../ingestion/.venv/Scripts/python -c "from gridanalyst.runner import run; run('daily_brief')"`.
3. **Me, next session:** wire the pipeline scheduler as a deployable worker (Railway `python -m gridsight.pipeline` entry point), rerun the packet builder against SPP-loaded data to confirm the 300k floor is met, and add the statistical trigger layer scaffolding (Phase 3 prep only — not starting Phase 3 until you review the scorecard design, per the spec).

## Decisions waiting on you

- ERCOT registration (blocks SPPs — the analyst's core signal).
- Anthropic API key (blocks live runs + scorecard burn-in).
- Phase 4 payments: keep the fully-wired Dodo Payments stack or switch to Stripe as the prompt specifies (recommendation: keep Dodo; details in BUILD_PLAN conflict #3).
- Scorecard design review before any Phase 3 work begins. Current design: `analyst/scorecard.jsonl`, one line per run — `ts, task, model, market_state, headline, self_grade_prior, degraded, cost_usd`; each run opens by grading the previous line's `self_grade_prior`.

Note: the energy-variant dev server may still be running at localhost:3000 from this session's verification.
