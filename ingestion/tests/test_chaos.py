"""Chaos tests — the acceptance criteria from the build prompt:

1. kill the network mid-fetch
2. corrupt one response payload
3. shift the system clock across a DST boundary

The pipeline must recover from all three without manual intervention: every
failure becomes a heartbeat row, no partial data commits, and the next good
run proceeds normally.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone

import httpx
import pytest
import tenacity
import time_machine
from sqlalchemy import func, select

from gridsight.adapters.eia import EiaAdapter
from gridsight.adapters.ercot import ErcotAdapter, ErcotAuth
from gridsight.models import Heartbeat, Observation
from gridsight.pipeline import _fetch_with_backoff, run_adapter

from conftest import make_eia_payload, make_ercot_dam_payload


@pytest.fixture(autouse=True)
def fast_retries():
    """Zero out backoff waits so chaos tests run in milliseconds."""
    original = _fetch_with_backoff.retry.wait
    _fetch_with_backoff.retry.wait = tenacity.wait_none()
    yield
    _fetch_with_backoff.retry.wait = original


def eia_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class OfflineErcotAuth(ErcotAuth):
    """Bypass the B2C token dance in tests."""

    def configured(self) -> bool:
        return True

    async def token(self, client) -> str:
        return "test-token"


class CannedErcotAdapter(ErcotAdapter):
    """ERCOT adapter fed canned payloads instead of the live API."""

    def __init__(self, payloads: list, product: str = "spp_dam"):
        super().__init__(product, OfflineErcotAuth())
        self._payloads = list(payloads)
        self.calls = 0

    async def fetch(self, client):
        self.calls += 1
        item = self._payloads.pop(0)
        if isinstance(item, Exception):
            raise item
        from gridsight.adapters.base import FetchResult

        return FetchResult(endpoint=f"ercot:{self.product}", payload=item)


async def heartbeats(session_factory):
    async with session_factory() as s:
        return (
            (await s.execute(select(Heartbeat).order_by(Heartbeat.id))).scalars().all()
        )


async def obs_count(session_factory):
    async with session_factory() as s:
        return (await s.execute(select(func.count(Observation.id)))).scalar()


class TestNetworkKillMidFetch:
    async def test_transient_drop_recovers_within_run(self, session_factory):
        """Connection dies twice mid-response; backoff retries land the third."""
        attempts = {"n": 0}

        def handler(request):
            attempts["n"] += 1
            if attempts["n"] < 3:
                raise httpx.ReadError("connection reset mid-body", request=request)
            return httpx.Response(200, json=make_eia_payload())

        async with eia_client(handler) as client:
            hb = await run_adapter(EiaAdapter("demand"), session_factory, client)

        assert hb.ok, hb.message
        assert attempts["n"] == 3
        assert hb.rows_upserted == 2
        assert await obs_count(session_factory) == 2

    async def test_total_outage_fails_into_heartbeat_then_recovers(
        self, session_factory
    ):
        """Network fully down: run fails as a heartbeat, never an exception;
        the next run (network back) succeeds without intervention."""

        def dead(request):
            raise httpx.ConnectError("network unreachable", request=request)

        async with eia_client(dead) as client:
            hb1 = await run_adapter(EiaAdapter("demand"), session_factory, client)
        assert not hb1.ok
        assert "ConnectError" in hb1.message
        assert await obs_count(session_factory) == 0  # nothing partial

        def alive(request):
            return httpx.Response(200, json=make_eia_payload())

        async with eia_client(alive) as client:
            hb2 = await run_adapter(EiaAdapter("demand"), session_factory, client)
        assert hb2.ok
        assert await obs_count(session_factory) == 2


class TestCorruptPayload:
    async def test_invalid_json_body(self, session_factory):
        def handler(request):
            return httpx.Response(200, content=b"<html>maintenance page</html>")

        async with eia_client(handler) as client:
            hb = await run_adapter(EiaAdapter("demand"), session_factory, client)
        assert not hb.ok
        assert await obs_count(session_factory) == 0

    async def test_mangled_envelope(self, session_factory):
        def handler(request):
            return httpx.Response(200, json={"response": {"data": "not-a-list"}})

        async with eia_client(handler) as client:
            hb = await run_adapter(EiaAdapter("demand"), session_factory, client)
        assert not hb.ok
        assert "ValidationFailure" in hb.message
        assert await obs_count(session_factory) == 0

    async def test_corrupt_record_values(self, session_factory):
        records = [
            {"period": "2026-07-05T05", "respondent": "ERCO", "value": "garbage"},
        ]

        def handler(request):
            return httpx.Response(200, json=make_eia_payload(records))

        async with eia_client(handler) as client:
            hb = await run_adapter(EiaAdapter("demand"), session_factory, client)
        assert not hb.ok
        assert await obs_count(session_factory) == 0

    async def test_one_bad_run_does_not_poison_the_next(self, session_factory):
        corrupt = CannedErcotAdapter([{"fields": "nope"}])
        good = CannedErcotAdapter([make_ercot_dam_payload()])
        async with httpx.AsyncClient() as client:
            hb1 = await run_adapter(corrupt, session_factory, client)
            hb2 = await run_adapter(good, session_factory, client)
        assert not hb1.ok
        assert hb2.ok
        # 3 tracked-point rows (the resource node row is filtered out)
        assert hb2.rows_upserted == 3
        hbs = await heartbeats(session_factory)
        assert [h.ok for h in hbs] == [False, True]


class TestClockAcrossDstBoundary:
    """Fall back 2025-11-02: ingest the same DAM day while the system clock
    sits on each side of the transition. Results must be identical, the
    repeated local hour must land on two distinct UTC intervals, and re-runs
    must stay idempotent."""

    DAM_DAY = [
        # 25-hour ERCOT day: HE 01, HE 02 twice (DSTFlag N then Y), HE 03..24
        ["2025-11-02", "01:00", "HB_NORTH", 18.0, "N"],
        ["2025-11-02", "02:00", "HB_NORTH", 19.0, "N"],
        ["2025-11-02", "02:00", "HB_NORTH", 20.0, "Y"],
        *[[f"2025-11-02", f"{he:02d}:00", "HB_NORTH", 21.0 + he, "N"] for he in range(3, 25)],
    ]

    async def _ingest(self, session_factory):
        adapter = CannedErcotAdapter([make_ercot_dam_payload(self.DAM_DAY)])
        async with httpx.AsyncClient() as client:
            return await run_adapter(adapter, session_factory, client)

    async def test_ingest_before_and_after_transition(self, session_factory):
        # Clock before the fall-back (still CDT in Texas)
        with time_machine.travel(datetime(2025, 11, 2, 5, 30, tzinfo=timezone.utc)):
            hb1 = await self._ingest(session_factory)
        assert hb1.ok, hb1.message
        assert hb1.rows_upserted == 25

        # Clock jumps across the transition; same publication re-fetched
        with time_machine.travel(datetime(2025, 11, 3, 9, 0, tzinfo=timezone.utc)):
            hb2 = await self._ingest(session_factory)
        assert hb2.ok, hb2.message
        assert hb2.rows_upserted == 0  # idempotent across the boundary

        async with session_factory() as s:
            starts = (
                (
                    await s.execute(
                        select(Observation.interval_start).order_by(
                            Observation.interval_start
                        )
                    )
                )
                .scalars()
                .all()
            )
        assert len(starts) == 25
        assert len(set(starts)) == 25  # repeated local hour != repeated UTC hour
        # Contiguous hourly coverage, no gap and no overlap
        deltas = {(b - a).total_seconds() for a, b in zip(starts, starts[1:])}
        assert deltas == {3600.0}
        # First interval starts 05:00 UTC (00:00 CDT), last starts
        # 05:00 UTC next day (23:00 CST) — a 25-hour local day.
        assert starts[0] == datetime(2025, 11, 2, 5)
        assert starts[-1] == datetime(2025, 11, 3, 5)

    async def test_spring_forward_gap_rejected_as_corrupt(self, session_factory):
        """A payload claiming the nonexistent 2026-03-08 HE 03:00 must fail
        validation-side, not silently shift an hour."""
        rows = [["2026-03-08", "03:00", "HB_NORTH", 30.0, "N"]]
        adapter = CannedErcotAdapter([make_ercot_dam_payload(rows)])
        with time_machine.travel(datetime(2026, 3, 8, 12, 0, tzinfo=timezone.utc)):
            async with httpx.AsyncClient() as client:
                hb = await run_adapter(adapter, session_factory, client)
        assert not hb.ok
        assert "NonexistentLocalTime" in hb.message
        assert await obs_count(session_factory) == 0
