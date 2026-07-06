"""Pipeline runner: drives adapters, records heartbeats, survives failure.

Failure philosophy: a run either commits all its rows or none (single
transaction). Any exception is caught at the run boundary, recorded as a
failed heartbeat, and never propagates out of run_adapter() — the scheduler
must outlive every category of source failure. Transient network errors are
retried in-run with exponential backoff first.

Schema drift: each run hashes the response's field names. On change we log
the diff to docs/PIPELINE_LOG.md and keep going — normalize() adapts via
FIELD_ALIASES where it can; if it can't, the run fails into a heartbeat,
not a crash.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from .adapters.base import FetchResult, SchemaDrift, SourceAdapter, schema_hash
from .models import Heartbeat, SchemaSnapshot
from .settings import settings
from .timeutil import utcnow

log = logging.getLogger("gridsight.pipeline")

PIPELINE_LOG = Path(__file__).resolve().parents[2] / "docs" / "PIPELINE_LOG.md"

_TRANSIENT = (httpx.TransportError, httpx.TimeoutException)


@retry(
    retry=retry_if_exception_type(_TRANSIENT),
    wait=wait_exponential(multiplier=1, min=1, max=60),
    stop=stop_after_attempt(4),
    reraise=True,
)
async def _fetch_with_backoff(
    adapter: SourceAdapter, client: httpx.AsyncClient
) -> FetchResult:
    return await adapter.fetch(client)


def _append_pipeline_log(entry: str) -> None:
    PIPELINE_LOG.parent.mkdir(parents=True, exist_ok=True)
    if not PIPELINE_LOG.exists():
        PIPELINE_LOG.write_text(
            "# Pipeline Log\n\nSchema drift and parser adaptations, newest last.\n",
            encoding="utf-8",
        )
    with PIPELINE_LOG.open("a", encoding="utf-8") as f:
        f.write(entry)


async def _check_schema_drift(
    session: AsyncSession, adapter: SourceAdapter, result: FetchResult
) -> str:
    """Compare this response's shape to the last snapshot. Returns the hash.

    On drift: persist the new shape, append the diff to PIPELINE_LOG.md.
    Never raises — drift is information, not failure.
    """
    fields = adapter.record_fields(result)
    if not fields:
        return ""
    new_hash = schema_hash(fields)
    snapshot = (
        await session.execute(
            select(SchemaSnapshot).where(
                SchemaSnapshot.source == adapter.source,
                SchemaSnapshot.endpoint == result.endpoint,
            )
        )
    ).scalar_one_or_none()

    if snapshot is None:
        session.add(
            SchemaSnapshot(
                source=adapter.source,
                endpoint=result.endpoint,
                schema_hash=new_hash,
                fields={"names": fields},
                first_seen=utcnow().replace(tzinfo=None),
            )
        )
    elif snapshot.schema_hash != new_hash:
        drift = SchemaDrift(
            endpoint=result.endpoint,
            old_fields=snapshot.fields.get("names", []),
            new_fields=fields,
        )
        log.warning(
            "schema drift on %s: +%s -%s", result.endpoint, drift.added, drift.removed
        )
        _append_pipeline_log(
            f"\n## {utcnow().isoformat()} — {result.endpoint}\n\n"
            f"- added fields: {drift.added or 'none'}\n"
            f"- removed fields: {drift.removed or 'none'}\n"
            f"- action: normalize() resolves fields via FIELD_ALIASES; "
            f"if a removed field has no alias the run fails into a heartbeat "
            f"and needs a parser fix.\n"
        )
        snapshot.schema_hash = new_hash
        snapshot.fields = {"names": fields}
        snapshot.first_seen = utcnow().replace(tzinfo=None)
    return new_hash


async def run_adapter(
    adapter: SourceAdapter,
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
) -> Heartbeat:
    """One full fetch->validate->normalize->upsert cycle with heartbeat.

    Never raises: every outcome, success or failure, becomes a heartbeat row.
    """
    started = utcnow()
    hb = Heartbeat(
        source=adapter.source, ts=started.replace(tzinfo=None), ok=False
    )
    try:
        result = await _fetch_with_backoff(adapter, client)
        hb.latency_ms = result.latency_ms
        async with session_factory() as session:
            async with session.begin():
                hb.schema_hash = await _check_schema_drift(session, adapter, result)
                adapter.validate(result)
                rows = adapter.normalize(result)
                hb.rows_upserted = await adapter.upsert(session, rows)
        hb.ok = True
        hb.message = "ok"
    except Exception as exc:  # noqa: BLE001 — run boundary must survive anything
        hb.ok = False
        hb.message = f"{type(exc).__name__}: {exc}"
        log.error("run failed for %s: %s", adapter.source, hb.message)

    async with session_factory() as session:
        async with session.begin():
            session.add(hb)
    return hb


async def run_forever(
    adapters: list[SourceAdapter],
    session_factory: async_sessionmaker[AsyncSession],
    interval_seconds: int | None = None,
) -> None:
    interval = interval_seconds or settings.fetch_interval_seconds
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        while True:
            for adapter in adapters:
                await run_adapter(adapter, session_factory, client)
            await asyncio.sleep(interval)


def default_adapters() -> list[SourceAdapter]:
    """The production roster. ERCOT joins automatically once credentialed."""
    from .adapters.eia import EiaAdapter
    from .adapters.ercot import ErcotAdapter, ErcotAuth
    from .adapters.noaa import NoaaAdapter

    roster: list[SourceAdapter] = [
        EiaAdapter("demand"),
        EiaAdapter("fuel_mix"),
        NoaaAdapter(),
    ]
    auth = ErcotAuth()
    if auth.configured():
        roster.append(ErcotAdapter("spp_dam", auth))
        roster.append(ErcotAdapter("spp_rtm", auth))
    else:
        log.warning("ERCOT credentials missing — SPP adapters not scheduled")
    return roster
