"""Backfill: pull trailing history so the analyst has context on day one.

Two backfills:

- EIA (runs today — key verified): 90 days of hourly ERCOT demand and
  generation by fuel. Real data available immediately.
- ERCOT SPPs (runs the moment credentials land): 90 days of DAM hourly and
  RTM 15-min settlement point prices for all 7 hubs + all 8 load zones.

Both are resumable and idempotent — re-running upserts the same keys.

Usage:
    .venv/Scripts/python -m gridsight.backfill --days 90
"""

from __future__ import annotations

import argparse
import asyncio
import logging
from datetime import timedelta

import httpx

from .adapters.eia import EiaAdapter, backfill_windows
from .adapters.ercot import ErcotAdapter, ErcotAuth
from .db import get_session_factory, init_db
from .settings import settings
from .timeutil import utcnow

log = logging.getLogger("gridsight.backfill")


async def backfill_eia(days: int = 90) -> int:
    """90 days of hourly ERCO demand + fuel mix from EIA."""
    session_factory = get_session_factory()
    total = 0
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        for dataset in ("demand", "fuel_mix"):
            adapter = EiaAdapter(dataset, respondents=("ERCO",), length=5000)
            for start, end in backfill_windows(days):
                offset = 0
                while True:
                    result = await adapter.fetch_window(client, start, end, offset)
                    adapter.validate(result)
                    rows = adapter.normalize(result)
                    if not rows:
                        break
                    async with session_factory() as session:
                        async with session.begin():
                            written = await adapter.upsert(session, rows)
                    total += written
                    log.info(
                        "eia %s %s..%s offset=%d rows=%d written=%d",
                        dataset, start.date(), end.date(), offset, len(rows), written,
                    )
                    got = len(adapter.records(result))
                    if got < adapter.length:
                        break
                    offset += got
                    await asyncio.sleep(0.5)  # stay polite
    return total


async def backfill_ercot(days: int = 90) -> int:
    """90 days of DAM + RTM SPPs. Requires ERCOT credentials."""
    auth = ErcotAuth()
    if not auth.configured():
        log.warning(
            "ERCOT backfill skipped — credentials missing (docs/DATA_ACCESS.md)"
        )
        return 0
    session_factory = get_session_factory()
    total = 0
    end = utcnow().date()
    start = end - timedelta(days=days)
    async with httpx.AsyncClient(timeout=settings.request_timeout_seconds) as client:
        for product in ("spp_dam", "spp_rtm"):
            adapter = ErcotAdapter(product, auth)
            # Small date chunks keep each response under the API's page size
            # (15 tracked points x 24h x 5d = 1.8k rows DAM; RTM is 4x).
            chunk = timedelta(days=5 if product == "spp_dam" else 1)
            cursor = start
            while cursor < end:
                upper = min(cursor + chunk, end)
                page = 1
                while True:
                    result = await adapter.fetch_window(client, cursor, upper, page)
                    adapter.validate(result)
                    rows = adapter.normalize(result)
                    async with session_factory() as session:
                        async with session.begin():
                            written = await adapter.upsert(session, rows)
                    total += written
                    log.info(
                        "ercot %s %s..%s page=%d written=%d",
                        product, cursor, upper, page, written,
                    )
                    meta = result.payload.get("_meta", {})
                    total_pages = int(meta.get("totalPages", 1))
                    if page >= total_pages:
                        break
                    page += 1
                    await asyncio.sleep(2.1)  # ERCOT publishes ~30 req/min limit
                cursor = upper
                await asyncio.sleep(2.1)
    return total


async def main(days: int) -> None:
    await init_db()
    eia_rows = await backfill_eia(days)
    ercot_rows = await backfill_ercot(days)
    log.info("backfill complete: eia=%d ercot=%d rows", eia_rows, ercot_rows)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=90)
    args = parser.parse_args()
    asyncio.run(main(args.days))
