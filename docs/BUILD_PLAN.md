# Build Plan — Grid's Eye View revenue build

Single source of truth. Read first every session, update last. Companion docs: `CODEBASE_MAP.md`, `DATA_ACCESS.md`, `PIPELINE_LOG.md` (created when the pipeline first adapts a parser), `HANDOFF.md`.

Status legend: [ ] todo · [~] in progress · [x] done · [!] blocked/waiting on Natan

## Session log

- **2026-07-06**: Phase 0 complete. App runs locally (`npm run dev:energy`, HTTP 200, no startup failures — zero fixes needed). EIA key works. ERCOT + Anthropic keys missing (see DATA_ACCESS.md). Started Phase 1.

## Conflicts between the build prompt and the existing codebase

1. **CLAUDE.md protects `api/`, `server/`, `src/services/` and the map files.** All new backend work therefore lives in new top-level dirs: `ingestion/` (Phase 1) and `analyst/` (Phase 2). Frontend integration in later phases goes through the variant system as CLAUDE.md requires. No conflict in practice; noted for the record.
2. **Prompt says Postgres; this machine has no Postgres and no Docker.** Deviation: SQLAlchemy 2.x with SQLite (WAL) for local dev/tests, Postgres via `DATABASE_URL` in production (Railway addon — repo already deploys workers to Railway). Same models, same idempotent-upsert semantics (`ON CONFLICT` works on both). Cheaper to reverse than forcing a local Postgres install; swap is a connection string.
3. **Prompt says Stripe Checkout (Phase 4); repo has Dodo Payments + Convex entitlements fully wired** (checkout, webhooks, subscription state, customer portal equivalents). Recommendation: reuse Dodo unless you specifically want Stripe. Decision deferred to Phase 4 — waiting on Natan.
4. **Prompt says "Resend or SES"; repo already integrates Resend** (Convex webhook handler + notification relay). Use Resend.
5. **Existing `api/chat-analyst.ts` is a Groq/OpenRouter chat analyst.** The new Fable analyst is a separate service; do not modify the old one (protected path). Long-term the old panel should point at the new analyst — Phase 4 wiring decision.

## Phase 0 — Reconnaissance [x]

- [x] `docs/CODEBASE_MAP.md`
- [x] Run app locally — clean startup, nothing to fix
- [x] `docs/DATA_ACCESS.md` — EIA working; ERCOT/PJM/Anthropic flagged for manual registration
- [x] This file

## Phase 1 — Ingestion layer [~]

New dir `ingestion/` (Python 3.11+, tested on 3.13):

```
ingestion/
  pyproject.toml            # deps: fastapi, uvicorn, sqlalchemy>=2, aiosqlite, asyncpg,
                            # httpx, pydantic>=2, tenacity, pytest, pytest-asyncio, time-machine
  README.md                 # run + deploy instructions
  gridsight/
    __init__.py
    settings.py             # pydantic-settings; DATABASE_URL (default sqlite), source keys
    db.py                   # async engine/session, dialect-aware upsert helper
    models.py               # observations, heartbeats, schema_hashes, ingest_log
    timeutil.py             # CPT<->UTC handling via zoneinfo; DST helpers
    adapters/
      base.py               # SourceAdapter ABC: fetch() / validate() / normalize() / upsert()
      ercot.py              # SPPs (DAM+RTM) via ERCOT Public API; OAuth (Azure B2C ROPC) + subscription key
      eia.py                # hourly demand/generation/fuel mix by BA (ERCO first)
      noaa.py               # weather.gov forecasts + observations for TX load zones
      pjm.py                # stub (raises NotImplementedError with registration pointer)
      miso.py               # stub
    pipeline.py             # scheduler loop, heartbeat writes, schema-hash drift handling
    backfill.py             # 90-day ERCOT SPP backfill (hubs + top-20 load zones by volume)
    app.py                  # FastAPI: /health, /heartbeats, /observations query endpoints
  tests/
    fixtures/               # captured real payloads incl. corrupted variants
    test_timeutil_dst.py    # spring-forward + fall-back, CPT->UTC round trips
    test_upsert_idempotent.py
    test_chaos.py           # network kill mid-fetch, corrupt payload, clock across DST
    test_schema_drift.py
```

Core semantics:

- Everything normalized to UTC; source timezone stored as column (`source_tz`). ERCOT publishes CPT — DST tests are mandatory (2026-03-08 spring forward, 2025-11-02 fall back).
- Upsert key: `(node, interval_start, data_version)`; revisions insert new `data_version`, latest resolved by view/query. Idempotent re-runs are a test.
- Heartbeat row per adapter run: last success, row count, latency ms, response schema hash. On hash change: log diff to `docs/PIPELINE_LOG.md`, attempt parser adaptation, never crash.
- Rate limits: tenacity exponential backoff, per-source concurrency 1, respect published limits.

Checklist:

- [ ] Skeleton + models + dialect-aware upsert
- [ ] timeutil + DST tests (write tests first)
- [ ] EIA adapter (key works today) + ERCOT-via-EIA hourly demand/gen backfill 90d — real data on day one
- [ ] ERCOT adapter (SPPs) — code complete against documented API, runs the moment the key lands [! key: Natan]
- [ ] NOAA adapter (TX load zone centroids)
- [ ] PJM/MISO stubs
- [ ] Chaos tests passing
- [ ] Heartbeats + schema-drift handling
- [ ] 90-day ERCOT SPP backfill executed [! blocked on ERCOT key]

## Phase 2 — The analyst [~ builder only this session]

New dir `analyst/` (Python, same venv):

```
analyst/
  gridanalyst/
    packet.py               # ContextPacket builder: TOC, stable-first ordering, token budget 300k-600k
    notes.py                # persistent notes read/compress (cap 20k tokens, preserve falsified)
    contract.py             # output JSON schema + validator; retry -> sonnet fallback + degradation flag
    model_router.py         # routing table as data: haiku=QA/heartbeat, sonnet=chat/alerts, fable=briefs/shock/deep-dive
    runner.py               # run loop: grade prior -> assemble -> call -> validate -> notes/scorecard
    costs.py                # token+dollar logging, $8 hard abort, prompt-cache markers
  notes/                    # {market}.md
  scorecard.jsonl
  tests/
    test_contract.py
    test_packet_assembly.py # assembles valid packet from real backfilled DB rows
    test_router.py
```

Session DoD: packet builder assembling a valid packet from real backfilled data (EIA-based if ERCOT key still pending). Live Fable runs wait for `ANTHROPIC_API_KEY` [! Natan].

## Phase 3 — Alerting [not started — do not start until scorecard design reviewed by Natan]

Statistical triggers (z-score, congestion spikes, reserve margin) → wake analyst → shock+med-confidence → email via Resend (reuse existing integration). Max 3/market/day, dedupe on causal-chain similarity, resolution follow-ups.

## Phase 4 — Product surface & paywall [not started]

Free: map, current prices, 7-day history. Pro: daily Fable brief, alerts, 90-day history, public scorecard. Payments: Dodo vs Stripe decision [! Natan]. Deep-dive endpoint with per-run price display.

## Decisions waiting on Natan

1. ERCOT Public API registration (blocks SPP backfill) — see DATA_ACCESS.md for exact steps.
2. `ANTHROPIC_API_KEY` for live analyst runs (costs money).
3. Phase 4: keep Dodo Payments or switch to Stripe.
4. Scorecard design review before Phase 3 begins (per prompt).
