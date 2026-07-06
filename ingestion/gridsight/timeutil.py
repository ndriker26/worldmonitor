"""Timezone handling for ISO data.

Everything in the database is UTC. Source timestamps arrive in the source's
local convention and must be converted exactly once, here.

ERCOT publishes in Central Prevailing Time (CPT = America/Chicago) using
hour-ending labels ("01:00".."24:00" / DeliveryHour 1..24) plus a DST flag:

- Fall back (e.g. 2025-11-02): the 01:00-02:00 local hour occurs twice.
  ERCOT publishes the repeated hour twice; rows with DSTFlag true are the
  *second* occurrence (standard time, CST).
- Spring forward (e.g. 2026-03-08): local 02:00-03:00 does not exist.
  ERCOT skips that hour-ending. We reject nonexistent local times loudly
  rather than let zoneinfo silently shift them.

This module is the number-one silent-bug surface in the pipeline; the DST
tests in tests/test_timeutil_dst.py are not optional.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

UTC = timezone.utc
CPT = ZoneInfo("America/Chicago")


class NonexistentLocalTime(ValueError):
    """Raised when a source claims a local time skipped by spring-forward."""


def _localize_strict(naive: datetime, tz: ZoneInfo, fold: int) -> datetime:
    """Attach tz to a naive local datetime, rejecting nonexistent times.

    A nonexistent local time (inside the spring-forward gap) does not
    round-trip: localize -> UTC -> local lands on a different wall clock.
    """
    local = naive.replace(tzinfo=tz, fold=fold)
    roundtrip = local.astimezone(UTC).astimezone(tz)
    if roundtrip.replace(tzinfo=None, fold=0) != naive:
        raise NonexistentLocalTime(
            f"{naive.isoformat()} does not exist in {tz.key} (spring-forward gap)"
        )
    return local


def hour_ending_to_utc_start(
    delivery_date: date,
    hour_ending: int | str,
    *,
    dst_flag: bool = False,
    tz: ZoneInfo = CPT,
) -> datetime:
    """Convert an ERCOT (date, hour-ending, DST flag) triple to the UTC
    interval *start*.

    hour_ending accepts 1..24, "1".."24", or "01:00".."24:00".
    Hour-ending N covers local [N-1, N); the start hour is N-1.
    dst_flag=True marks the second occurrence of a repeated fall-back hour.
    """
    he = int(str(hour_ending).split(":")[0])
    if not 1 <= he <= 24:
        raise ValueError(f"hour_ending out of range: {hour_ending!r}")
    naive = datetime.combine(delivery_date, time(hour=he - 1))
    # fold=1 selects the second occurrence of an ambiguous (repeated) time.
    local = _localize_strict(naive, tz, fold=1 if dst_flag else 0)
    return local.astimezone(UTC)


def interval_15min_to_utc_start(
    delivery_date: date,
    delivery_hour: int,
    delivery_interval: int,
    *,
    dst_flag: bool = False,
    tz: ZoneInfo = CPT,
) -> datetime:
    """ERCOT RTM keys: DeliveryHour 1..24 (hour-ending), DeliveryInterval 1..4
    (15-minute slots within the hour). Returns the UTC interval start.
    """
    if not 1 <= delivery_interval <= 4:
        raise ValueError(f"delivery_interval out of range: {delivery_interval}")
    hour_start = hour_ending_to_utc_start(
        delivery_date, delivery_hour, dst_flag=dst_flag, tz=tz
    )
    return hour_start + timedelta(minutes=15 * (delivery_interval - 1))


def eia_period_to_utc(period: str) -> datetime:
    """EIA v2 hourly period strings are UTC, e.g. '2026-07-06T18'."""
    return datetime.strptime(period, "%Y-%m-%dT%H").replace(tzinfo=UTC)


def parse_iso_utc(value: str) -> datetime:
    """Parse an ISO-8601 timestamp (NOAA style, offset-aware) into UTC."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        raise ValueError(f"naive timestamp not allowed: {value!r}")
    return dt.astimezone(UTC)


def utcnow() -> datetime:
    return datetime.now(UTC)
