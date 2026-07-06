"""DST transition tests for CPT -> UTC conversion.

ERCOT publishes in Central Prevailing Time. These tests pin the exact
behavior at both 2026 transitions (and the 2025 fall-back, which is inside
our 90-day backfill window as of July 2026):

- Spring forward 2026-03-08: 02:00 CST jumps to 03:00 CDT. Local hour
  ending 03:00 (02:00-03:00) does not exist.
- Fall back 2025-11-02: 02:00 CDT falls to 01:00 CST. Local hour
  01:00-02:00 occurs twice; DSTFlag distinguishes them.
"""

from datetime import date, datetime, timezone

import pytest

from gridsight.timeutil import (
    NonexistentLocalTime,
    eia_period_to_utc,
    hour_ending_to_utc_start,
    interval_15min_to_utc_start,
)

UTC = timezone.utc


class TestNormalDays:
    def test_summer_cdt_offset(self):
        # HE 01:00 on a July day: starts 00:00 CDT = 05:00 UTC
        assert hour_ending_to_utc_start(date(2026, 7, 6), 1) == datetime(
            2026, 7, 6, 5, tzinfo=UTC
        )

    def test_winter_cst_offset(self):
        # HE 24:00 on a January day: starts 23:00 CST = 05:00 UTC next day
        assert hour_ending_to_utc_start(date(2026, 1, 15), 24) == datetime(
            2026, 1, 16, 5, tzinfo=UTC
        )

    def test_hour_ending_string_forms(self):
        d = date(2026, 7, 6)
        assert (
            hour_ending_to_utc_start(d, "14:00")
            == hour_ending_to_utc_start(d, "14")
            == hour_ending_to_utc_start(d, 14)
        )

    def test_hour_ending_bounds(self):
        with pytest.raises(ValueError):
            hour_ending_to_utc_start(date(2026, 7, 6), 0)
        with pytest.raises(ValueError):
            hour_ending_to_utc_start(date(2026, 7, 6), 25)


class TestSpringForward2026:
    """2026-03-08: 23-hour day in CPT."""

    def test_he2_is_last_cst_hour(self):
        # HE 02:00 = local 01:00-02:00 CST -> starts 07:00 UTC
        assert hour_ending_to_utc_start(date(2026, 3, 8), 2) == datetime(
            2026, 3, 8, 7, tzinfo=UTC
        )

    def test_he3_does_not_exist(self):
        # Local 02:00-03:00 was skipped. A source claiming it is corrupt.
        with pytest.raises(NonexistentLocalTime):
            hour_ending_to_utc_start(date(2026, 3, 8), 3)

    def test_he4_is_first_cdt_hour(self):
        # HE 04:00 = local 03:00-04:00 CDT -> starts 08:00 UTC,
        # contiguous with HE 02:00's end (08:00 UTC).
        assert hour_ending_to_utc_start(date(2026, 3, 8), 4) == datetime(
            2026, 3, 8, 8, tzinfo=UTC
        )

    def test_day_has_23_contiguous_hours(self):
        starts = []
        for he in range(1, 25):
            if he == 3:
                continue
            starts.append(hour_ending_to_utc_start(date(2026, 3, 8), he))
        assert len(starts) == 23
        deltas = {(b - a).total_seconds() for a, b in zip(starts, starts[1:])}
        assert deltas == {3600.0}


class TestFallBack2025:
    """2025-11-02: 25-hour day in CPT, inside the 90-day backfill window."""

    def test_first_occurrence_is_cdt(self):
        # HE 02:00 first pass = 01:00-02:00 CDT -> starts 06:00 UTC
        assert hour_ending_to_utc_start(
            date(2025, 11, 2), 2, dst_flag=False
        ) == datetime(2025, 11, 2, 6, tzinfo=UTC)

    def test_second_occurrence_is_cst(self):
        # HE 02:00 repeated (DSTFlag=Y) = 01:00-02:00 CST -> starts 07:00 UTC
        assert hour_ending_to_utc_start(
            date(2025, 11, 2), 2, dst_flag=True
        ) == datetime(2025, 11, 2, 7, tzinfo=UTC)

    def test_repeated_hours_map_to_distinct_utc(self):
        first = hour_ending_to_utc_start(date(2025, 11, 2), 2, dst_flag=False)
        second = hour_ending_to_utc_start(date(2025, 11, 2), 2, dst_flag=True)
        assert first != second
        assert (second - first).total_seconds() == 3600

    def test_day_has_25_contiguous_hours(self):
        starts = [hour_ending_to_utc_start(date(2025, 11, 2), 1)]
        starts.append(hour_ending_to_utc_start(date(2025, 11, 2), 2, dst_flag=False))
        starts.append(hour_ending_to_utc_start(date(2025, 11, 2), 2, dst_flag=True))
        for he in range(3, 25):
            starts.append(hour_ending_to_utc_start(date(2025, 11, 2), he))
        assert len(starts) == 25
        deltas = {(b - a).total_seconds() for a, b in zip(starts, starts[1:])}
        assert deltas == {3600.0}

    def test_dst_flag_ignored_on_unambiguous_hours(self):
        # DSTFlag on a non-repeated hour must not change the result.
        assert hour_ending_to_utc_start(
            date(2025, 11, 2), 10, dst_flag=True
        ) == hour_ending_to_utc_start(date(2025, 11, 2), 10, dst_flag=False)


class TestRtm15Min:
    def test_intervals_within_hour(self):
        base = interval_15min_to_utc_start(date(2026, 7, 6), 5, 1)
        for i in range(1, 5):
            dt = interval_15min_to_utc_start(date(2026, 7, 6), 5, i)
            assert (dt - base).total_seconds() == 900 * (i - 1)

    def test_fall_back_repeated_quarter_hours(self):
        first = interval_15min_to_utc_start(date(2025, 11, 2), 2, 3, dst_flag=False)
        second = interval_15min_to_utc_start(date(2025, 11, 2), 2, 3, dst_flag=True)
        assert (second - first).total_seconds() == 3600

    def test_interval_bounds(self):
        with pytest.raises(ValueError):
            interval_15min_to_utc_start(date(2026, 7, 6), 5, 5)


class TestEiaPeriods:
    def test_hourly_period_is_utc(self):
        assert eia_period_to_utc("2026-07-06T18") == datetime(
            2026, 7, 6, 18, tzinfo=UTC
        )
