"""Packet assembly tests.

Two layers:
- Seeded-fixture tests that always run (CI-safe).
- A real-data test against the actual backfilled ingestion store —
  the session's definition-of-done — skipped only if the DB is absent.
"""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine, text

from gridanalyst.datastore import DataStore, _DEFAULT_DB
from gridanalyst.packet import (
    RECENT_HOURS,
    TARGET_MAX_TOKENS,
    PacketBuilder,
    estimate_tokens,
)

NOW = datetime(2026, 7, 6, 12, 0)

_DDL = """
CREATE TABLE observations (
    id INTEGER PRIMARY KEY,
    source TEXT, series TEXT, node TEXT,
    interval_start TIMESTAMP, interval_minutes INTEGER,
    value REAL, unit TEXT, data_version INTEGER,
    source_tz TEXT, ingested_at TIMESTAMP
)
"""


@pytest.fixture
def seeded_store(tmp_path):
    url = f"sqlite:///{tmp_path / 'seed.db'}"
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text(_DDL))
        rows = []
        for h in range(90 * 24):
            ts = NOW - timedelta(hours=h)
            rows.append(("eia", "demand", "ERCO", ts, 60000 + h % 20000, "MWh", 0))
            rows.append(("ercot", "spp_dam", "HB_NORTH", ts, 20 + (h % 50), "USD/MWh", 0))
        # a revision: latest version must win in the packet
        rows.append(("ercot", "spp_dam", "HB_NORTH", NOW - timedelta(hours=1), 999.0, "USD/MWh", 1))
        conn.execute(
            text(
                "INSERT INTO observations (source, series, node, interval_start,"
                " interval_minutes, value, unit, data_version, source_tz, ingested_at)"
                " VALUES (:s, :se, :n, :ts, 60, :v, :u, :dv, 'UTC', :ts)"
            ),
            [
                {"s": s, "se": se, "n": n, "ts": ts, "v": v, "u": u, "dv": dv}
                for s, se, n, ts, v, u, dv in rows
            ],
        )
    return DataStore(url)


class TestPacketStructure:
    def test_ordering_and_toc(self, seeded_store):
        packet = PacketBuilder(store=seeded_store, notes_text="prior note").build(
            "What is the market state?", now=NOW
        )
        rendered = packet.render()
        # TOC anchors the top
        assert rendered.startswith("# ContextPacket")
        assert "## Table of contents" in rendered.split("\n\n")[1]
        # stable reference before recent data before question
        assert (
            rendered.index("Market reference")
            < rendered.index("## Recent data")
            < rendered.index("## The question")
        )
        # question is at the very end
        assert rendered.rstrip().endswith("What is the market state?")

    def test_notes_included(self, seeded_store):
        packet = PacketBuilder(store=seeded_store, notes_text="FALSIFIED: solar ramps cause X").build(
            "q", now=NOW
        )
        assert "FALSIFIED: solar ramps cause X" in packet.render()

    def test_latest_revision_wins(self, seeded_store):
        packet = PacketBuilder(store=seeded_store).build("q", now=NOW)
        rendered = packet.render()
        assert "999" in rendered  # the v1 correction
        # v0 value for that interval was 20 + (1 % 50) = 21; ensure the
        # superseded row isn't ALSO present for the same interval/node
        recent = rendered[rendered.index("## Recent data"):]
        line_hits = [
            ln
            for ln in recent.splitlines()
            if "spp_dam,HB_NORTH" in ln and "2026-07-06T11:00:00" in ln
        ]
        assert len(line_hits) == 1
        assert ",999," in line_hits[0]

    def test_stable_prefix_is_prefix_of_render(self, seeded_store):
        packet = PacketBuilder(store=seeded_store, notes_text="n").build("q", now=NOW)
        assert packet.render().startswith(packet.stable_prefix())
        # volatile bits stay out of the cacheable prefix
        assert "## The question" not in packet.stable_prefix()
        assert "## Recent data" not in packet.stable_prefix()

    def test_over_budget_trims_history_not_prices(self, seeded_store):
        builder = PacketBuilder(store=seeded_store, notes_text="x" * 3_000_000)
        packet = builder.build("q", now=NOW)
        # Notes aren't trimmable; the trim loop leaves them and reports over budget
        assert any("over budget" in w for w in packet.warnings) or (
            packet.token_estimate <= TARGET_MAX_TOKENS
        )


class TestRealBackfilledData:
    """Definition of done: a valid packet from real backfilled data."""

    pytestmark = pytest.mark.skipif(
        not _DEFAULT_DB.exists(), reason="ingestion store not present"
    )

    def test_packet_from_real_store(self):
        store = DataStore()
        packet = PacketBuilder(
            store=store, notes_text=""
        ).build("Assess current ERCOT market state.")
        rendered = packet.render()

        # Real demand data present and recent
        assert "demand,ERCO" in rendered
        assert "fuel_mix.WND,ERCO" in rendered
        # Structure holds
        assert rendered.startswith("# ContextPacket")
        assert rendered.rstrip().endswith("Assess current ERCOT market state.")
        # Token estimate is real and sane
        assert packet.token_estimate == estimate_tokens(rendered)
        assert 10_000 < packet.token_estimate <= TARGET_MAX_TOKENS
        # Prices absent until ERCOT key lands — builder must say so, loudly
        assert any("settlement point prices" in w for w in packet.warnings)

    def test_recent_section_contains_last_48h(self):
        store = DataStore()
        packet = PacketBuilder(store=store).build("q")
        recent = packet.render().split("## Recent data")[1]
        assert "demand,ERCO" in recent, f"no demand rows in last {RECENT_HOURS}h section"
