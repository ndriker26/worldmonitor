"""Async engine/session plumbing and the dialect-aware idempotent upsert.

SQLite (local dev/tests) and Postgres (production) both support
INSERT ... ON CONFLICT DO UPDATE; SQLAlchemy exposes each through its own
dialect module. upsert_observations() picks the right one at runtime so the
adapters never care which store they are talking to.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from .models import Base, Observation
from .settings import settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None

# Columns that identify an observation; everything else is updatable payload.
_IDENTITY = ("source", "series", "node", "interval_start", "data_version")
_UPDATABLE = ("value", "unit", "interval_minutes", "source_tz", "ingested_at")


def get_engine(url: str | None = None) -> AsyncEngine:
    global _engine, _session_factory
    if _engine is None:
        _engine = create_async_engine(url or settings.database_url)
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    if _session_factory is None:
        get_engine()
    assert _session_factory is not None
    return _session_factory


async def init_db(engine: AsyncEngine | None = None) -> None:
    engine = engine or get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


def reset_engine() -> None:
    """Test hook: forget the cached engine so tests can use their own URL."""
    global _engine, _session_factory
    _engine = None
    _session_factory = None


def _insert_for_dialect(dialect_name: str):
    if dialect_name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    elif dialect_name == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:  # pragma: no cover - guard against a surprise third dialect
        raise RuntimeError(f"unsupported dialect for upsert: {dialect_name}")
    return insert


async def upsert_observations(
    session: AsyncSession,
    rows: Iterable[Mapping[str, Any]],
) -> int:
    """Idempotently upsert observation rows inside the caller's transaction.

    Re-running the same batch is a no-op apart from `ingested_at`. A revision
    (same node/interval, higher data_version) inserts a new row rather than
    mutating history.
    """
    rows = list(rows)
    if not rows:
        return 0
    insert = _insert_for_dialect(session.bind.dialect.name)
    stmt = insert(Observation)
    stmt = stmt.on_conflict_do_update(
        index_elements=list(_IDENTITY),
        set_={col: getattr(stmt.excluded, col) for col in _UPDATABLE},
    )
    # Chunk to stay under SQLite's bound-parameter ceiling.
    CHUNK = 400
    for i in range(0, len(rows), CHUNK):
        await session.execute(stmt, rows[i : i + CHUNK])
    return len(rows)


async def upsert_observations_versioned(
    session: AsyncSession,
    rows: Iterable[Mapping[str, Any]],
) -> int:
    """Revision-aware idempotent upsert.

    ISOs republish corrected values. Semantics per (source, series, node,
    interval_start):

    - unseen key            -> insert at data_version 0
    - seen, value unchanged -> no-op (idempotent re-runs)
    - seen, value changed   -> insert at latest data_version + 1 (revision);
                               history is never destroyed

    Returns the number of rows actually written.
    """
    from sqlalchemy import func, select, tuple_

    rows = list(rows)
    if not rows:
        return 0

    keys = {(r["source"], r["series"], r["node"], r["interval_start"]) for r in rows}
    latest: dict[tuple, tuple[int, float]] = {}
    key_cols = tuple_(
        Observation.source,
        Observation.series,
        Observation.node,
        Observation.interval_start,
    )
    key_list = list(keys)
    CHUNK = 200
    for i in range(0, len(key_list), CHUNK):
        subq = (
            select(
                Observation.source,
                Observation.series,
                Observation.node,
                Observation.interval_start,
                func.max(Observation.data_version).label("v"),
            )
            .where(key_cols.in_(key_list[i : i + CHUNK]))
            .group_by(
                Observation.source,
                Observation.series,
                Observation.node,
                Observation.interval_start,
            )
            .subquery()
        )
        result = await session.execute(
            select(
                Observation.source,
                Observation.series,
                Observation.node,
                Observation.interval_start,
                Observation.data_version,
                Observation.value,
            ).join(
                subq,
                (Observation.source == subq.c.source)
                & (Observation.series == subq.c.series)
                & (Observation.node == subq.c.node)
                & (Observation.interval_start == subq.c.interval_start)
                & (Observation.data_version == subq.c.v),
            )
        )
        for src, series, node, start, version, value in result:
            latest[(src, series, node, start)] = (version, value)

    to_write: list[dict[str, Any]] = []
    for r in rows:
        key = (r["source"], r["series"], r["node"], r["interval_start"])
        row = dict(r)
        if key not in latest:
            row.setdefault("data_version", 0)
            to_write.append(row)
            latest[key] = (row["data_version"], row["value"])
        else:
            version, existing_value = latest[key]
            if existing_value != row["value"]:
                row["data_version"] = version + 1
                to_write.append(row)
                latest[key] = (row["data_version"], row["value"])

    return await upsert_observations(session, to_write)
