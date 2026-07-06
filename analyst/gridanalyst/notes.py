"""Persistent analyst notes.

After every run the analyst appends structured observations to
analyst/notes/{market}.md. Notes are always included in the next packet.
Cap: 20k tokens — when exceeded, the *analyst* compresses its own notes
(that's a model call; this module provides the trigger and the compression
prompt). Falsified hypotheses must survive compression: knowing what is
wrong is as valuable as knowing what is right.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .packet import estimate_tokens

NOTES_DIR = Path(__file__).resolve().parents[1] / "notes"
NOTES_TOKEN_CAP = 20_000

TEMPLATE = """\
# Analyst notes — {market}

## Patterns confirmed

## Patterns falsified
<!-- NEVER delete entries here during compression -->

## Open hypotheses (with confidence)
"""

COMPRESSION_PROMPT = """\
Your notes file exceeds the 20,000-token cap. Rewrite it to fit well under
the cap while preserving:
1. EVERY entry under "Patterns falsified" — verbatim where possible,
   condensed only if necessary, never dropped.
2. All open hypotheses, with their confidence levels.
3. Confirmed patterns, merged and deduplicated.
Drop: narrative filler, superseded observations, anything derivable from the
data itself. Output the complete rewritten notes file and nothing else.
"""


def notes_path(market: str) -> Path:
    return NOTES_DIR / f"{market}.md"


def read(market: str) -> str:
    path = notes_path(market)
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def append(market: str, observation: str) -> None:
    path = notes_path(market)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(TEMPLATE.format(market=market), encoding="utf-8")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%MZ")
    with path.open("a", encoding="utf-8") as f:
        f.write(f"\n### {stamp}\n{observation.strip()}\n")


def needs_compression(market: str) -> bool:
    return estimate_tokens(read(market)) > NOTES_TOKEN_CAP


def write_compressed(market: str, compressed: str) -> None:
    """Replace notes with the analyst's own compression. Guard the invariant:
    the falsified section must still exist."""
    if "Patterns falsified" not in compressed:
        raise ValueError(
            "compressed notes dropped the 'Patterns falsified' section — refusing to write"
        )
    notes_path(market).write_text(compressed, encoding="utf-8")
