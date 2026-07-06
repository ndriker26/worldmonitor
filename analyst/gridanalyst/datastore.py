"""Read-only access to the ingestion store.

Deliberately self-contained: reads the `observations` table via plain SQL
over a sync SQLAlchemy engine rather than importing the ingestion package.
Same DATABASE_URL convention (SQLite locally, Postgres in production).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import create_engine, text

_REPO_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_DB = _REPO_ROOT / "ingestion" / "gridsight.db"


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if url:
        # analyst uses sync drivers; strip async driver suffixes if present
        return url.replace("+asyncpg", "").replace("+aiosqlite", "")
    return f"sqlite:///{_DEFAULT_DB.as_posix()}"


@dataclass
class Row:
    series: str
    node: str
    interval_start: datetime
    value: float
    unit: str


class DataStore:
    def __init__(self, url: str | None = None) -> None:
        self.engine = create_engine(url or database_url())

    def series_window(
        self,
        series_prefix: str,
        days: int,
        now: datetime | None = None,
    ) -> list[Row]:
        """Latest-version observations for all series matching a prefix,
        over the trailing N days, oldest first."""
        now = now or datetime.now(timezone.utc).replace(tzinfo=None)
        if now.tzinfo is not None:
            now = now.astimezone(timezone.utc).replace(tzinfo=None)
        start = now - timedelta(days=days)
        stmt = text(
            """
            SELECT series, node, interval_start, value, unit, data_version
            FROM observations
            WHERE series LIKE :prefix AND interval_start >= :start
            ORDER BY interval_start, node, data_version
            """
        )
        latest: dict[tuple[str, str, datetime], Row] = {}
        with self.engine.connect() as conn:
            for series, node, start_ts, value, unit, _v in conn.execute(
                stmt, {"prefix": series_prefix + "%", "start": start}
            ):
                if isinstance(start_ts, str):
                    start_ts = datetime.fromisoformat(start_ts)
                latest[(series, node, start_ts)] = Row(series, node, start_ts, value, unit)
        return sorted(latest.values(), key=lambda r: (r.interval_start, r.series, r.node))

    def available_series(self) -> list[tuple[str, int]]:
        with self.engine.connect() as conn:
            return list(
                conn.execute(
                    text("SELECT series, COUNT(*) FROM observations GROUP BY series ORDER BY 1")
                )
            )
