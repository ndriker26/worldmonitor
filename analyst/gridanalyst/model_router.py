"""Model routing — the table is data, not scattered string literals.

Rules (from the build spec):
- Haiku: heartbeat checks, data QA summaries
- Sonnet: alert formatting, user-facing chat, and the contract-failure
  fallback for analyst runs
- Fable: daily brief, shock analysis, paid deep dives

Model IDs and pricing verified against the Anthropic model catalog
(2026-07-06). Fable 5 notes that matter here:
- thinking is always on; never send a `thinking` param
- no temperature/top_p/top_k
- effort via output_config.effort; high only for shock runs, medium routine
"""

from __future__ import annotations

from dataclasses import dataclass

FABLE = "claude-fable-5"
SONNET = "claude-sonnet-4-6"
HAIKU = "claude-haiku-4-5"


@dataclass(frozen=True)
class Route:
    model: str
    effort: str          # output_config.effort
    max_tokens: int
    stream: bool = True  # stream anything that could run long


# task name -> route. Add tasks here, not model strings in call sites.
ROUTES: dict[str, Route] = {
    "heartbeat_check": Route(HAIKU, "low", 1024, stream=False),
    "data_qa_summary": Route(HAIKU, "low", 2048, stream=False),
    "alert_format": Route(SONNET, "low", 2048, stream=False),
    "user_chat": Route(SONNET, "medium", 4096),
    "daily_brief": Route(FABLE, "medium", 16000),
    "shock_analysis": Route(FABLE, "high", 16000),
    "deep_dive": Route(FABLE, "high", 32000),
    # Contract-failure fallback: one retry on the primary model, then this.
    "contract_fallback": Route(SONNET, "high", 16000),
}

# USD per million tokens (input, output) — for costs.py projections.
PRICING: dict[str, tuple[float, float]] = {
    FABLE: (10.00, 50.00),
    SONNET: (3.00, 15.00),
    HAIKU: (1.00, 5.00),
}

# Cache multipliers relative to input price (5-minute TTL ephemeral cache).
CACHE_WRITE_MULT = 1.25
CACHE_READ_MULT = 0.10


def route(task: str) -> Route:
    if task not in ROUTES:
        raise KeyError(f"no route for task {task!r} — add it to ROUTES")
    return ROUTES[task]
