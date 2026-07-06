"""FastAPI surface for the ingestion service.

Read-only introspection endpoints; the frontend and the analyst consume
these rather than touching the database directly.

Run:
    .venv/Scripts/python -m uvicorn gridsight.app:app --port 8100
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Query
from sqlalchemy import func, select

from . import __version__
from .db import get_session_factory, init_db
from .models import Heartbeat, Observation


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="gridsight-ingestion", version=__version__, lifespan=lifespan)


@app.get("/health")
async def health() -> dict:
    session_factory = get_session_factory()
    async with session_factory() as session:
        count = (await session.execute(select(func.count(Observation.id)))).scalar()
    return {"status": "ok", "version": __version__, "observations": count}


@app.get("/heartbeats")
async def heartbeats(limit: int = Query(50, le=500)) -> list[dict]:
    session_factory = get_session_factory()
    async with session_factory() as session:
        rows = (
            await session.execute(
                select(Heartbeat).order_by(Heartbeat.ts.desc()).limit(limit)
            )
        ).scalars()
        return [
            {
                "source": h.source,
                "ts": h.ts.isoformat() + "Z",
                "ok": h.ok,
                "rows_upserted": h.rows_upserted,
                "latency_ms": h.latency_ms,
                "schema_hash": h.schema_hash,
                "message": h.message,
            }
            for h in rows
        ]


@app.get("/observations")
async def observations(
    series: str,
    node: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(1000, le=10000),
) -> list[dict]:
    """Latest-version observations for a series, oldest first."""
    session_factory = get_session_factory()
    stmt = select(Observation).where(Observation.series == series)
    if node:
        stmt = stmt.where(Observation.node == node)
    if start:
        stmt = stmt.where(Observation.interval_start >= start.replace(tzinfo=None))
    if end:
        stmt = stmt.where(Observation.interval_start < end.replace(tzinfo=None))
    stmt = stmt.order_by(
        Observation.interval_start, Observation.node, Observation.data_version
    ).limit(limit)
    async with session_factory() as session:
        rows = (await session.execute(stmt)).scalars().all()
    # Collapse to latest data_version per (node, interval_start).
    latest: dict[tuple, Observation] = {}
    for o in rows:
        latest[(o.node, o.interval_start)] = o
    return [
        {
            "node": o.node,
            "interval_start": o.interval_start.isoformat() + "Z",
            "interval_minutes": o.interval_minutes,
            "value": o.value,
            "unit": o.unit,
            "data_version": o.data_version,
            "source": o.source,
        }
        for o in latest.values()
    ]
