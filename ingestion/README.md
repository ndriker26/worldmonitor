# gridsight-ingestion

Ingestion layer for Grid's Eye View. Python 3.11+ (developed on 3.13), FastAPI, SQLAlchemy 2 async. SQLite locally, Postgres in production via `DATABASE_URL` (see `docs/BUILD_PLAN.md` conflict #2 for the justification).

## Setup

```sh
cd ingestion
python -m venv .venv
.venv/Scripts/python -m pip install -e ".[dev]"        # add ,postgres] for prod
```

Keys are read from the repo-root `.env` / `.env.local` (see `docs/DATA_ACCESS.md` for status of each source).

## Commands

```sh
.venv/Scripts/python -m pytest                          # full suite incl. chaos tests
.venv/Scripts/python -m gridsight.backfill --days 90    # trailing history (EIA now; ERCOT once credentialed)
.venv/Scripts/python -m uvicorn gridsight.app:app --port 8100   # /health /heartbeats /observations
.venv/Scripts/python -c "import asyncio; from gridsight.pipeline import run_forever, default_adapters; from gridsight.db import get_session_factory, init_db; asyncio.run((lambda: (init_db(), run_forever(default_adapters(), get_session_factory())))()[1])"
```

(For the live loop, prefer `python -m gridsight.pipeline` once a supervisor entry point is added; on Railway run it as a worker process.)

## Layout

- `gridsight/timeutil.py` — CPT/UTC conversion, hour-ending semantics, DST safety. Read its docstring before touching anything time-related.
- `gridsight/models.py` — `observations` (versioned, idempotent), `heartbeats`, `schema_snapshots`.
- `gridsight/db.py` — dialect-aware `ON CONFLICT` upsert + revision-aware wrapper.
- `gridsight/adapters/` — one module per source implementing `fetch/validate/normalize/upsert`. ERCOT is code-complete but needs credentials; PJM/MISO are deliberate stubs.
- `gridsight/pipeline.py` — run loop, heartbeats, retry/backoff, schema-drift logging to `docs/PIPELINE_LOG.md`.
- `gridsight/backfill.py` — resumable, idempotent trailing-history pull.
- `tests/test_chaos.py` — the acceptance tests: network kill mid-fetch, corrupt payload, clock across a DST boundary.
