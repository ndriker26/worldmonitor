"""ContextPacket builder.

Assembles one analysis packet per run, ordered for deep-context retrieval:

    1. Table of contents (anchors retrieval from deep context)
    2. Stable reference data (market structure, node glossary, methodology)
    3. Analyst's persistent notes (prior patterns, falsified hypotheses)
    4. Historical time series, oldest first
    5. Recent data (last 48h) — closest to the question
    6. The question, at the very end

Token budget: target 300k-600k per packet; Fable's 1M window is the ceiling,
never the target. Local estimation uses chars/4 (the standard heuristic);
when an ANTHROPIC_API_KEY is present the runner re-measures the assembled
packet with the count_tokens endpoint and records both numbers.

The stable prefix (sections 1-3 plus historical series) is deliberately
byte-stable across runs within a day so prompt caching on the prefix works:
volatile content (current timestamp, latest hours, the question) comes last.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from .datastore import DataStore, Row

TARGET_MIN_TOKENS = 300_000
TARGET_MAX_TOKENS = 600_000
RECENT_HOURS = 48


def estimate_tokens(text: str) -> int:
    """chars/4 heuristic. The runner verifies with count_tokens when keyed."""
    return len(text) // 4


REFERENCE_ERCOT = """\
## Market reference: ERCOT

ERCOT operates the Texas interconnection: ~90 GW peak load, energy-only
market (no capacity market), scarcity pricing via ORDC up to the $5,000/MWh
cap. Settlement points tracked: 7 hubs (HB_BUSAVG, HB_HOUSTON, HB_HUBAVG,
HB_NORTH, HB_PAN, HB_SOUTH, HB_WEST) and all 8 load zones (LZ_AEN, LZ_CPS,
LZ_HOUSTON, LZ_LCRA, LZ_NORTH, LZ_RAYBN, LZ_SOUTH, LZ_WEST).

Structural facts that recur in causal chains:
- West zone is wind-heavy; wind lulls plus summer heat drive West-to-North
  congestion and basis blowouts.
- Solar sets the evening net-load ramp; the risk window is the 19:00-21:00 CPT
  hour ending as solar rolls off while load holds.
- ERCOT publishes in Central Prevailing Time; all data below is UTC.
- Demand and fuel-mix series are EIA hourly (respondent ERCO). Settlement
  point prices arrive via the ERCOT Public API (DAM hourly, RTM 15-min).

Series glossary:
- demand: hourly load, MWh
- fuel_mix.<FUEL>: hourly net generation by fuel (NG, WND, SUN, NUC, COL, WAT, BAT, OTH), MWh
- spp_dam / spp_rtm: settlement point prices, USD/MWh
- fcst_temp / fcst_wind: NOAA hourly forecast per load zone (F, mph)
"""

METHODOLOGY = """\
## Methodology notes

- Prices and loads are UTC interval starts; intervals are 60min unless noted.
- Values may be revised by the ISO after first publication; the store keeps
  every revision and this packet contains only the latest version of each
  interval.
- Data gaps are real gaps (source outages), not zeros. Never interpolate
  silently; call out gaps that affect conclusions.
"""


@dataclass
class Section:
    title: str
    body: str

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.body)


@dataclass
class ContextPacket:
    sections: list[Section]
    question: str
    generated_at: datetime
    stable_prefix_sections: int  # sections [0:N] are the cacheable prefix
    token_estimate: int = 0
    warnings: list[str] = field(default_factory=list)

    def render(self) -> str:
        toc = "\n".join(
            f"{i + 1}. {s.title}" for i, s in enumerate(self.sections)
        )
        parts = [f"# ContextPacket — Grid's Eye View analyst\n\n## Table of contents\n{toc}\n"]
        parts += [f"\n{s.body}" for s in self.sections]
        parts.append(f"\n## The question\n\n{self.question}\n")
        return "\n".join(parts)

    def stable_prefix(self) -> str:
        """The byte-stable portion for prompt-cache breakpoint placement."""
        toc = "\n".join(f"{i + 1}. {s.title}" for i, s in enumerate(self.sections))
        parts = [f"# ContextPacket — Grid's Eye View analyst\n\n## Table of contents\n{toc}\n"]
        parts += [f"\n{s.body}" for s in self.sections[: self.stable_prefix_sections]]
        return "\n".join(parts)


def _rows_to_csv(rows: list[Row]) -> str:
    lines = ["interval_start_utc,series,node,value,unit"]
    lines += [
        f"{r.interval_start.isoformat()},{r.series},{r.node},{r.value:g},{r.unit}"
        for r in rows
    ]
    return "\n".join(lines)


def _split_recent(rows: list[Row], cutoff: datetime) -> tuple[list[Row], list[Row]]:
    hist = [r for r in rows if r.interval_start < cutoff]
    recent = [r for r in rows if r.interval_start >= cutoff]
    return hist, recent


class PacketBuilder:
    def __init__(self, store: DataStore | None = None, notes_text: str = "") -> None:
        self.store = store or DataStore()
        self.notes_text = notes_text

    def build(
        self,
        question: str,
        *,
        market: str = "ERCOT",
        price_days: int = 30,
        context_days: int = 90,
        now: datetime | None = None,
    ) -> ContextPacket:
        """Assemble a packet. Prices use the spec'd 30-day window; demand,
        fuel mix, and weather can use the longer window for pattern context.
        """
        now = now or datetime.now(timezone.utc).replace(tzinfo=None)
        recent_cutoff = now - timedelta(hours=RECENT_HOURS)
        warnings: list[str] = []

        prices = self.store.series_window("spp_", price_days, now)
        demand = self.store.series_window("demand", context_days, now)
        fuel = self.store.series_window("fuel_mix.", context_days, now)
        weather = self.store.series_window("fcst_", 8, now)  # fcst horizon ~7d

        if not prices:
            warnings.append(
                "no settlement point prices in store (ERCOT API key pending) — "
                "packet uses demand/fuel-mix/weather only"
            )
        # Outage/derate notices land with the ERCOT adapter's next phase.
        outages_note = (
            "## Outage and derate notices\n\nNo outage feed ingested yet "
            "(arrives with the ERCOT Public API integration). Treat "
            "generation drops in the fuel mix as the only outage signal."
        )

        price_hist, price_recent = _split_recent(prices, recent_cutoff)
        demand_hist, demand_recent = _split_recent(demand, recent_cutoff)
        fuel_hist, fuel_recent = _split_recent(fuel, recent_cutoff)

        sections = [
            Section("Market reference (stable)", REFERENCE_ERCOT),
            Section("Methodology notes (stable)", METHODOLOGY),
            Section(
                "Analyst notes (prior patterns and falsified hypotheses)",
                "## Analyst notes\n\n" + (self.notes_text or "_No prior notes — first run._"),
            ),
            Section(
                f"Historical settlement point prices ({price_days}d, hourly/15-min)",
                "## Historical settlement point prices\n\n" + _rows_to_csv(price_hist),
            ),
            Section(
                f"Historical demand ({context_days}d, hourly)",
                "## Historical demand\n\n" + _rows_to_csv(demand_hist),
            ),
            Section(
                f"Historical generation by fuel ({context_days}d, hourly)",
                "## Historical generation by fuel\n\n" + _rows_to_csv(fuel_hist),
            ),
            Section("Outage and derate notices", outages_note),
            Section(
                "Weather forecast (NOAA, per load zone)",
                "## Weather forecast\n\n" + _rows_to_csv(weather),
            ),
            Section(
                f"Recent data (last {RECENT_HOURS}h) — read this closest",
                "## Recent data\n\n"
                + _rows_to_csv(demand_recent + fuel_recent + price_recent),
            ),
        ]

        # Stable prefix = reference + methodology + notes + historical series.
        # Everything from outages onward is volatile per run.
        packet = ContextPacket(
            sections=sections,
            question=question,
            generated_at=now,
            stable_prefix_sections=6,
            warnings=warnings,
        )
        packet.token_estimate = estimate_tokens(packet.render())

        if packet.token_estimate > TARGET_MAX_TOKENS:
            # Trim the largest historical section's oldest rows until under
            # budget. Prices trim last — they are the analyst's core signal.
            packet.warnings.append(
                f"packet over budget ({packet.token_estimate} est tokens) — trimmed oldest rows"
            )
            self._trim(packet)
        elif packet.token_estimate < TARGET_MIN_TOKENS:
            packet.warnings.append(
                f"packet under 300k target ({packet.token_estimate} est tokens) — "
                "expected until ERCOT RTM prices are backfilled; not an error"
            )
        return packet

    @staticmethod
    def _trim(packet: ContextPacket) -> None:
        trimmable = [s for s in packet.sections if s.title.startswith("Historical")]
        # Prices trim last
        trimmable.sort(key=lambda s: ("prices" in s.title, -s.tokens))
        for section in trimmable:
            while packet.token_estimate > TARGET_MAX_TOKENS:
                lines = section.body.split("\n")
                if len(lines) < 1000:
                    break
                # Drop the oldest 20% of data lines (header rows preserved)
                header, data = lines[:3], lines[3:]
                keep = data[len(data) // 5 :]
                section.body = "\n".join(header + keep)
                packet.token_estimate = estimate_tokens(packet.render())
            if packet.token_estimate <= TARGET_MAX_TOKENS:
                return
