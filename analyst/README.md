# gridanalyst

Fable-powered grid analyst for Grid's Eye View. Self-contained service: reads the ingestion store directly (same `DATABASE_URL` convention), calls `claude-fable-5` through the Messages API.

## Setup

Shares the ingestion venv:

```sh
cd analyst
../ingestion/.venv/Scripts/python -m pip install -e ".[dev]"
../ingestion/.venv/Scripts/python -m pytest
```

Live runs additionally need `ANTHROPIC_API_KEY` in the environment (not yet provisioned — see `docs/DATA_ACCESS.md`).

## Pieces

- `packet.py` — ContextPacket builder. TOC first, stable reference → notes → history → recent 48h → question last. 300k–600k token target (1M is the ceiling, not the target); stable prefix is byte-stable for prompt caching.
- `contract.py` — the output JSON schema, enforced twice: server-side via `output_config.format` and locally via jsonschema. Retry once → Sonnet fallback with `degraded=True`.
- `model_router.py` — routing table as data. Haiku: QA/heartbeats. Sonnet: chat/alerts/fallback. Fable: daily brief (`effort: medium`), shock analysis + deep dives (`effort: high`).
- `costs.py` — token/dollar logging to `analyst_runs`, $8 hard-budget abort *before* the API call (projection uses real `count_tokens` numbers).
- `notes.py` — persistent notes per market, 20k-token cap, model-driven compression that must preserve falsified hypotheses.
- `runner.py` — the run loop: grade prior → assemble → call → validate → scorecard (`scorecard.jsonl`) + notes + cost log. Server-side refusal fallback to Opus 4.8 enabled by default.

## Run

```sh
../ingestion/.venv/Scripts/python -c "from gridanalyst.runner import run; print(run('daily_brief').data['headline'])"
```

`notes/` and `scorecard.jsonl` are the analyst's persistent memory and burn-in evidence — they are meant to be committed.
