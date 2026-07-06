"""The analyst output contract.

Every analyst run must produce JSON matching OUTPUT_SCHEMA. Enforcement is
belt and suspenders: the schema is passed to the API as a structured-output
format (output_config.format), and every response is validated locally with
jsonschema anyway. On validation failure the runner retries once on the
primary model, then falls back to Sonnet with `degraded` flagged.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import jsonschema

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "market_state",
        "headline",
        "causal_chain",
        "affected_nodes",
        "duration_estimate",
        "historical_analogs",
        "tradeable_thesis",
        "self_grade_prior",
    ],
    "properties": {
        "market_state": {"type": "string", "enum": ["normal", "elevated", "shock"]},
        "headline": {"type": "string"},
        "causal_chain": {"type": "array", "items": {"type": "string"}},
        "affected_nodes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["node", "current_price", "expected_range", "deviation_sigma"],
                "properties": {
                    "node": {"type": "string"},
                    "current_price": {"type": "number"},
                    "expected_range": {
                        "type": "array",
                        "items": {"type": "number"},
                    },
                    "deviation_sigma": {"type": "number"},
                },
            },
        },
        "duration_estimate": {
            "type": "object",
            "additionalProperties": False,
            "required": ["hours", "confidence", "basis"],
            "properties": {
                "hours": {"type": "number"},
                "confidence": {"type": "string", "enum": ["low", "med", "high"]},
                "basis": {"type": "string"},
            },
        },
        "historical_analogs": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["date", "similarity", "how_it_resolved"],
                "properties": {
                    "date": {"type": "string"},
                    "similarity": {"type": "string"},
                    "how_it_resolved": {"type": "string"},
                },
            },
        },
        "tradeable_thesis": {"type": "string"},
        "self_grade_prior": {"type": "string"},
    },
}


class ContractViolation(ValueError):
    """The model's output does not satisfy OUTPUT_SCHEMA."""


@dataclass
class AnalystOutput:
    data: dict[str, Any]
    degraded: bool = False  # True when served by the Sonnet fallback

    @property
    def market_state(self) -> str:
        return self.data["market_state"]


def validate(raw: str | dict[str, Any]) -> dict[str, Any]:
    """Parse (if needed) and validate one analyst response.

    Raises ContractViolation with a precise reason; returns the parsed dict.
    """
    if isinstance(raw, str):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ContractViolation(f"not valid JSON: {exc}") from exc
    else:
        data = raw
    try:
        jsonschema.validate(data, OUTPUT_SCHEMA)
    except jsonschema.ValidationError as exc:
        raise ContractViolation(
            f"schema violation at {'/'.join(str(p) for p in exc.absolute_path) or '<root>'}: "
            f"{exc.message}"
        ) from exc
    # expected_range must be a [low, high] pair — jsonschema draft here can't
    # express the length constraint alongside structured-output limits, so
    # enforce it manually.
    for node in data["affected_nodes"]:
        rng = node["expected_range"]
        if len(rng) != 2 or rng[0] > rng[1]:
            raise ContractViolation(
                f"expected_range for {node['node']} must be [low, high], got {rng}"
            )
    return data
