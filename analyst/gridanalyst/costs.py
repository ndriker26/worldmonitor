"""Cost accounting: token/dollar logging and the hard budget abort.

Every run logs input/output tokens and dollar cost to the analyst_runs
table in the ingestion store. Any run *projected* over the hard budget
aborts before the API call and surfaces an alert instead.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from .datastore import DataStore
from .model_router import CACHE_READ_MULT, CACHE_WRITE_MULT, PRICING

HARD_BUDGET_USD = 8.00


class BudgetExceeded(RuntimeError):
    """Projected run cost exceeds the hard budget — do not call the API."""


def project_cost_usd(
    model: str,
    input_tokens: int,
    max_output_tokens: int,
    cached_fraction: float = 0.0,
) -> float:
    """Worst-case projection: full max_tokens output, cache reads applied to
    the cached fraction of input."""
    in_price, out_price = PRICING[model]
    cached = input_tokens * cached_fraction
    fresh = input_tokens - cached
    cost = (
        fresh * in_price
        + cached * in_price * CACHE_READ_MULT
        + max_output_tokens * out_price
    ) / 1_000_000
    return round(cost, 4)


def actual_cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
) -> float:
    in_price, out_price = PRICING[model]
    cost = (
        input_tokens * in_price
        + cache_creation_tokens * in_price * CACHE_WRITE_MULT
        + cache_read_tokens * in_price * CACHE_READ_MULT
        + output_tokens * out_price
    ) / 1_000_000
    return round(cost, 6)


def check_budget(projected_usd: float) -> None:
    if projected_usd > HARD_BUDGET_USD:
        raise BudgetExceeded(
            f"projected ${projected_usd:.2f} exceeds ${HARD_BUDGET_USD:.2f} hard budget — "
            "aborting; alert Natan instead of running"
        )


_DDL = """
CREATE TABLE IF NOT EXISTS analyst_runs (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    task TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL,
    degraded INTEGER NOT NULL DEFAULT 0,
    meta TEXT
)
"""


def log_run(
    store: DataStore,
    task: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_tokens: int = 0,
    cache_read_tokens: int = 0,
    degraded: bool = False,
    meta: dict | None = None,
) -> float:
    cost = actual_cost_usd(
        model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens
    )
    with store.engine.begin() as conn:
        conn.execute(text(_DDL))
        conn.execute(
            text(
                "INSERT INTO analyst_runs (ts, task, model, input_tokens, output_tokens,"
                " cache_creation_tokens, cache_read_tokens, cost_usd, degraded, meta)"
                " VALUES (:ts, :task, :model, :it, :ot, :cc, :cr, :cost, :deg, :meta)"
            ),
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "task": task,
                "model": model,
                "it": input_tokens,
                "ot": output_tokens,
                "cc": cache_creation_tokens,
                "cr": cache_read_tokens,
                "cost": cost,
                "deg": int(degraded),
                "meta": json.dumps(meta or {}),
            },
        )
    return cost
