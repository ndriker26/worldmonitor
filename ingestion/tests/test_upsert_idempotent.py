"""Idempotency and revision semantics of the versioned upsert."""

from datetime import datetime

from sqlalchemy import func, select

from gridsight.db import upsert_observations_versioned
from gridsight.models import Observation


def obs_row(node="HB_NORTH", start=datetime(2026, 7, 5, 5), value=22.15, **kw):
    return {
        "source": "ercot",
        "series": "spp_dam",
        "node": node,
        "interval_start": start,
        "interval_minutes": 60,
        "value": value,
        "unit": "USD/MWh",
        "source_tz": "America/Chicago",
        "ingested_at": datetime(2026, 7, 6, 0),
        **kw,
    }


async def count(session_factory):
    async with session_factory() as s:
        return (await s.execute(select(func.count(Observation.id)))).scalar()


class TestIdempotency:
    async def test_rerun_same_batch_is_noop(self, session_factory):
        batch = [obs_row(), obs_row(node="LZ_HOUSTON", value=24.32)]
        for _ in range(3):
            async with session_factory() as s:
                async with s.begin():
                    await upsert_observations_versioned(s, batch)
        assert await count(session_factory) == 2

    async def test_second_run_writes_zero(self, session_factory):
        batch = [obs_row()]
        async with session_factory() as s:
            async with s.begin():
                first = await upsert_observations_versioned(s, batch)
        async with session_factory() as s:
            async with s.begin():
                second = await upsert_observations_versioned(s, batch)
        assert first == 1
        assert second == 0


class TestRevisions:
    async def test_changed_value_creates_new_version(self, session_factory):
        async with session_factory() as s:
            async with s.begin():
                await upsert_observations_versioned(s, [obs_row(value=22.15)])
        # ISO republishes a corrected price for the same interval
        async with session_factory() as s:
            async with s.begin():
                await upsert_observations_versioned(s, [obs_row(value=25.40)])

        async with session_factory() as s:
            rows = (
                (await s.execute(select(Observation).order_by(Observation.data_version)))
                .scalars()
                .all()
            )
        assert [(r.data_version, r.value) for r in rows] == [(0, 22.15), (1, 25.4)]

    async def test_revision_then_rerun_is_stable(self, session_factory):
        async with session_factory() as s:
            async with s.begin():
                await upsert_observations_versioned(s, [obs_row(value=22.15)])
                await upsert_observations_versioned(s, [obs_row(value=25.40)])
        # Re-sending the latest correction must not mint version 2
        async with session_factory() as s:
            async with s.begin():
                written = await upsert_observations_versioned(s, [obs_row(value=25.40)])
        assert written == 0
        assert await count(session_factory) == 2

    async def test_versions_scoped_per_interval(self, session_factory):
        a = obs_row(start=datetime(2026, 7, 5, 5), value=10.0)
        b = obs_row(start=datetime(2026, 7, 5, 6), value=11.0)
        async with session_factory() as s:
            async with s.begin():
                await upsert_observations_versioned(s, [a, b])
                await upsert_observations_versioned(
                    s, [dict(a, value=12.0)]  # revise only hour 5
                )
        async with session_factory() as s:
            rows = (
                (
                    await s.execute(
                        select(
                            Observation.interval_start,
                            Observation.data_version,
                            Observation.value,
                        ).order_by(Observation.interval_start, Observation.data_version)
                    )
                )
                .all()
            )
        assert rows == [
            (datetime(2026, 7, 5, 5), 0, 10.0),
            (datetime(2026, 7, 5, 5), 1, 12.0),
            (datetime(2026, 7, 5, 6), 0, 11.0),
        ]
