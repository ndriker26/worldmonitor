"""Analyst run loop.

One run = grade the previous run's prior -> assemble ContextPacket ->
call the routed model -> validate against the contract -> persist notes,
scorecard, and cost log.

Live calls require ANTHROPIC_API_KEY. Everything up to the API call
(packet assembly, budget projection, contract validation) is exercised by
tests without a key.

Fable 5 API notes honored here (verified against the current API docs):
- thinking is always on for claude-fable-5 — no `thinking` param is sent
- no temperature/top_p — steering is prompt + effort only
- effort goes in output_config.effort (high only for shock runs)
- structured output enforced server-side via output_config.format AND
  validated locally; one retry, then Sonnet fallback with degraded=True
- server-side refusal fallback to claude-opus-4-8 is enabled by default
  (beta server-side-fallback-2026-06-01) so a classifier false-positive
  doesn't kill a run outright
- prompt caching: cache_control breakpoint at the end of the packet's
  stable prefix; volatile content and the question come after it
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from . import costs, notes
from .contract import OUTPUT_SCHEMA, AnalystOutput, ContractViolation, validate
from .datastore import DataStore
from .model_router import FABLE, route
from .packet import ContextPacket, PacketBuilder

log = logging.getLogger("gridanalyst.runner")

SCORECARD = Path(__file__).resolve().parents[1] / "scorecard.jsonl"

SYSTEM_PROMPT = """\
You are the staff power-market analyst for Grid's Eye View, covering ERCOT.
You write for traders and grid operators: short sentences, numbers with
context, no hedging filler. Cite specific data points (node, UTC interval,
value) as evidence for every causal claim. If you see no edge, say
'no edge' — a wrong thesis is worse than no thesis. Grade your previous
prediction honestly before anything else; your credibility compounds from
the scorecard, not from any single call.
"""


def grade_prior_instruction(prior: str | None) -> str:
    if not prior:
        return "There is no previous prediction to grade (first run)."
    return (
        "Begin by grading this prediction from your previous run against what "
        f"the data now shows, in one short paragraph: {prior!r}"
    )


def last_self_grade_prior() -> str | None:
    if not SCORECARD.exists():
        return None
    lines = SCORECARD.read_text(encoding="utf-8").strip().splitlines()
    if not lines:
        return None
    return json.loads(lines[-1]).get("self_grade_prior")


def append_scorecard(entry: dict) -> None:
    SCORECARD.parent.mkdir(parents=True, exist_ok=True)
    with SCORECARD.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, default=str) + "\n")


def build_messages(packet: ContextPacket) -> list[dict]:
    """Stable prefix carries the cache breakpoint; volatile tail follows."""
    stable = packet.stable_prefix()
    full = packet.render()
    volatile = full[len(stable):]
    return [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": stable,
                    "cache_control": {"type": "ephemeral"},
                },
                {"type": "text", "text": volatile},
            ],
        }
    ]


def run(
    task: str = "daily_brief",
    question: str | None = None,
    market: str = "ERCOT",
    store: DataStore | None = None,
) -> AnalystOutput:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY not set — live analyst runs are blocked "
            "(docs/DATA_ACCESS.md). Packet assembly can be tested without it."
        )
    import anthropic

    client = anthropic.Anthropic()
    store = store or DataStore()
    r = route(task)

    prior = last_self_grade_prior()
    question = question or (
        "Produce today's market brief for ERCOT. "
        + grade_prior_instruction(prior)
        + " Then assess current market state against the contract."
    )
    builder = PacketBuilder(store=store, notes_text=notes.read(market))
    packet = builder.build(question, market=market)
    for w in packet.warnings:
        log.warning("packet: %s", w)

    # Measure the real token count, then enforce the hard budget.
    messages = build_messages(packet)
    input_tokens = client.messages.count_tokens(model=r.model, messages=messages).input_tokens
    projected = costs.project_cost_usd(r.model, input_tokens, r.max_tokens)
    costs.check_budget(projected)  # raises BudgetExceeded before any spend
    log.info("run %s: %d input tokens, projected $%.2f", task, input_tokens, projected)

    def call(model: str, effort: str) -> tuple[str, object]:
        kwargs: dict = dict(
            model=model,
            max_tokens=r.max_tokens,
            system=SYSTEM_PROMPT,
            messages=messages,
            output_config={
                "effort": effort,
                "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA},
            },
        )
        if model == FABLE:
            # Refusal fallback: classifier false-positives (grid security
            # adjacency) transparently re-serve on Opus 4.8.
            with client.beta.messages.stream(
                betas=["server-side-fallback-2026-06-01"],
                fallbacks=[{"model": "claude-opus-4-8"}],
                **kwargs,
            ) as stream:
                resp = stream.get_final_message()
        else:
            with client.messages.stream(**kwargs) as stream:
                resp = stream.get_final_message()
        if resp.stop_reason == "refusal":
            raise ContractViolation("model (and fallback chain) refused the request")
        text = "".join(b.text for b in resp.content if b.type == "text")
        return text, resp

    degraded = False
    model_used = r.model
    try:
        raw, resp = call(r.model, r.effort)
        data = validate(raw)
    except ContractViolation as first_error:
        log.warning("contract failure on %s: %s — retrying once", r.model, first_error)
        try:
            raw, resp = call(r.model, r.effort)
            data = validate(raw)
        except ContractViolation as second_error:
            log.error("second failure: %s — falling back to Sonnet", second_error)
            fb = route("contract_fallback")
            raw, resp = call(fb.model, fb.effort)
            data = validate(raw)  # a third failure propagates — that's an incident
            degraded = True
            model_used = fb.model

    usage = resp.usage
    cost = costs.log_run(
        store,
        task,
        model_used,
        usage.input_tokens,
        usage.output_tokens,
        getattr(usage, "cache_creation_input_tokens", 0) or 0,
        getattr(usage, "cache_read_input_tokens", 0) or 0,
        degraded=degraded,
        meta={"packet_tokens_estimated": packet.token_estimate, "market": market},
    )
    log.info("run complete: $%.4f, degraded=%s", cost, degraded)

    append_scorecard(
        {
            "ts": datetime.now(timezone.utc).isoformat(),
            "task": task,
            "model": model_used,
            "market_state": data["market_state"],
            "headline": data["headline"],
            "self_grade_prior": data["self_grade_prior"],
            "degraded": degraded,
            "cost_usd": cost,
        }
    )
    notes.append(
        market,
        f"[{task}] state={data['market_state']} — {data['headline']}\n"
        f"Thesis: {data['tradeable_thesis']}",
    )
    if notes.needs_compression(market):
        log.warning("notes over 20k tokens — compression run needed (notes.COMPRESSION_PROMPT)")

    return AnalystOutput(data=data, degraded=degraded)
