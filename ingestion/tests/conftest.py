from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from gridsight.models import Base


@pytest.fixture
async def session_factory(tmp_path):
    """Fresh file-backed SQLite DB per test (in-memory doesn't survive
    multiple connections from the async pool)."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


def make_ercot_dam_payload(rows: list[list] | None = None, fields: list[str] | None = None) -> dict:
    """ERCOT Public API response shape: fields[] + positional data[][]."""
    fields = fields or [
        "deliveryDate",
        "hourEnding",
        "settlementPoint",
        "settlementPointPrice",
        "DSTFlag",
    ]
    if rows is None:
        rows = [
            ["2026-07-05", "01:00", "HB_NORTH", 22.15, "N"],
            ["2026-07-05", "02:00", "HB_NORTH", 19.80, "N"],
            ["2026-07-05", "01:00", "LZ_HOUSTON", 24.32, "N"],
            ["2026-07-05", "01:00", "SOME_RESOURCE_NODE", 21.01, "N"],  # untracked
        ]
    return {
        "_meta": {"totalRecords": len(rows), "totalPages": 1},
        "fields": [{"name": f} for f in fields],
        "data": rows,
    }


def make_eia_payload(records: list[dict] | None = None) -> dict:
    if records is None:
        records = [
            {"period": "2026-07-05T05", "respondent": "ERCO", "type": "D", "value": "61000", "value-units": "megawatthours"},
            {"period": "2026-07-05T06", "respondent": "ERCO", "type": "D", "value": "63500", "value-units": "megawatthours"},
        ]
    return {"response": {"total": len(records), "data": records}}
