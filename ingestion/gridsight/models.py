"""Database models.

Design notes:

- `observations` is the single normalized time-series table. Upserts are
  idempotent, keyed on (source, series, node, interval_start, data_version).
  The prompt's key is (node, interval_start, data_version); source+series
  are included because node labels collide across sources/series (e.g.
  "LZ_NORTH" carries both DAM and RTM prices).
- ISOs republish corrected values: a revision arrives as a higher
  data_version for the same (node, interval_start). Readers resolve the
  latest version; nothing is ever destructively overwritten across versions.
- All timestamps are UTC (naive columns holding UTC — SQLite has no tz
  support; the boundary converts). `source_tz` records the publisher's
  native timezone for audit.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Observation(Base):
    __tablename__ = "observations"
    __table_args__ = (
        UniqueConstraint(
            "source", "series", "node", "interval_start", "data_version",
            name="uq_obs_identity",
        ),
        Index("ix_obs_series_node_time", "series", "node", "interval_start"),
        Index("ix_obs_time", "interval_start"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(16))          # ercot | eia | noaa
    series: Mapped[str] = mapped_column(String(48))          # spp_dam | demand | fuel_mix.NG | temp_c ...
    node: Mapped[str] = mapped_column(String(64))            # HB_NORTH | ERCO | station id
    interval_start: Mapped[datetime] = mapped_column(DateTime())  # UTC
    interval_minutes: Mapped[int] = mapped_column(Integer, default=60)
    value: Mapped[float] = mapped_column(Float)
    unit: Mapped[str] = mapped_column(String(24), default="")
    data_version: Mapped[int] = mapped_column(Integer, default=0)
    source_tz: Mapped[str] = mapped_column(String(32), default="UTC")
    ingested_at: Mapped[datetime] = mapped_column(DateTime())      # UTC


class Heartbeat(Base):
    """One row per adapter run — the pipeline's black box recorder."""

    __tablename__ = "heartbeats"
    __table_args__ = (Index("ix_hb_source_ts", "source", "ts"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(16))
    ts: Mapped[datetime] = mapped_column(DateTime())               # UTC
    ok: Mapped[bool] = mapped_column(Boolean)
    rows_upserted: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    schema_hash: Mapped[str] = mapped_column(String(64), default="")
    message: Mapped[str] = mapped_column(Text, default="")


class SchemaSnapshot(Base):
    """Last known response shape per (source, endpoint) for drift detection."""

    __tablename__ = "schema_snapshots"
    __table_args__ = (
        UniqueConstraint("source", "endpoint", name="uq_schema_source_endpoint"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(16))
    endpoint: Mapped[str] = mapped_column(String(128))
    schema_hash: Mapped[str] = mapped_column(String(64))
    fields: Mapped[dict] = mapped_column(JSON)
    first_seen: Mapped[datetime] = mapped_column(DateTime())       # UTC
