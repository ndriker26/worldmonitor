"""EIA v2 adapter — hourly demand and generation-by-fuel per balancing
authority. ERCOT (respondent ERCO) first; the respondent list is data, so
adding PJM/MISO later is a config change.

EIA v2 notes:
- frequency=hourly returns periods in UTC ("2026-07-06T18"); the
  local-hourly variant is never used here.
- Hard cap of 5000 rows per response; backfill paginates with offset.
- EIA revises recent hours; the versioned upsert records revisions.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, ClassVar

import httpx

from ..settings import settings
from ..timeutil import eia_period_to_utc, utcnow
from .base import FetchResult, SourceAdapter, ValidationFailure

BASE = "https://api.eia.gov/v2"

# (route, facet extras, series template, unit)
_DATASETS = {
    "demand": (
        "/electricity/rto/region-data/data/",
        {"facets[type][]": "D"},
        "demand",
        "MWh",
    ),
    "fuel_mix": (
        "/electricity/rto/fuel-type-data/data/",
        {},
        "fuel_mix.{fueltype}",
        "MWh",
    ),
}


class EiaAdapter(SourceAdapter):
    source: ClassVar[str] = "eia"
    source_tz: ClassVar[str] = "UTC"
    FIELD_ALIASES: ClassVar[dict[str, tuple[str, ...]]] = {
        "period": ("Period", "datetime", "timestamp"),
        "respondent": ("Respondent", "respondent-name-id", "ba"),
        "value": ("Value", "data"),
        "fueltype": ("fuelType", "fuel-type", "fuel"),
    }

    def __init__(
        self,
        dataset: str = "demand",
        respondents: tuple[str, ...] = ("ERCO",),
        length: int = 500,
    ) -> None:
        if dataset not in _DATASETS:
            raise ValueError(f"unknown EIA dataset: {dataset}")
        self.dataset = dataset
        self.respondents = respondents
        self.length = length

    # -- request building ----------------------------------------------------
    def request_params(
        self,
        start: datetime | None = None,
        end: datetime | None = None,
        offset: int = 0,
    ) -> tuple[str, dict[str, Any]]:
        route, extras, _, _ = _DATASETS[self.dataset]
        params: dict[str, Any] = {
            "api_key": settings.eia_api_key,
            "frequency": "hourly",
            "data[0]": "value",
            "sort[0][column]": "period",
            "sort[0][direction]": "desc",
            "length": self.length,
            "offset": offset,
            **extras,
        }
        for i, resp in enumerate(self.respondents):
            params[f"facets[respondent][{i}]"] = resp
        if start:
            params["start"] = start.strftime("%Y-%m-%dT%H")
        if end:
            params["end"] = end.strftime("%Y-%m-%dT%H")
        return BASE + route, params

    async def fetch(self, client: httpx.AsyncClient) -> FetchResult:
        url, params = self.request_params()
        started = utcnow()
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        latency = int((utcnow() - started).total_seconds() * 1000)
        return FetchResult(
            endpoint=f"eia:{self.dataset}", payload=resp.json(), latency_ms=latency
        )

    async def fetch_window(
        self,
        client: httpx.AsyncClient,
        start: datetime,
        end: datetime,
        offset: int = 0,
    ) -> FetchResult:
        url, params = self.request_params(start=start, end=end, offset=offset)
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return FetchResult(endpoint=f"eia:{self.dataset}", payload=resp.json())

    # -- contract ------------------------------------------------------------
    def records(self, result: FetchResult) -> list[Any]:
        try:
            return result.payload["response"]["data"]
        except (KeyError, TypeError) as exc:
            raise ValidationFailure(f"eia: malformed envelope: {exc!r}") from exc

    def validate(self, result: FetchResult) -> None:
        records = self.records(result)
        if not isinstance(records, list):
            raise ValidationFailure("eia: response.data is not a list")
        for rec in records[:5]:
            period = self.resolve_field(rec, "period")
            eia_period_to_utc(str(period))
            value = self.resolve_field(rec, "value")
            if value is not None:
                float(value)

    def normalize(self, result: FetchResult) -> list[dict[str, Any]]:
        _, _, series_tpl, unit = _DATASETS[self.dataset]
        now = utcnow().replace(tzinfo=None)
        rows: list[dict[str, Any]] = []
        for rec in self.records(result):
            value = self.resolve_field(rec, "value")
            if value is None:  # EIA publishes explicit nulls for missing hours
                continue
            series = series_tpl
            if "{fueltype}" in series_tpl:
                series = series_tpl.format(
                    fueltype=str(self.resolve_field(rec, "fueltype")).upper()
                )
            start = eia_period_to_utc(str(self.resolve_field(rec, "period")))
            rows.append(
                {
                    "source": self.source,
                    "series": series,
                    "node": str(self.resolve_field(rec, "respondent")),
                    "interval_start": start.replace(tzinfo=None),
                    "interval_minutes": 60,
                    "value": float(value),
                    "unit": unit,
                    "source_tz": self.source_tz,
                    "ingested_at": now,
                }
            )
        return rows


def backfill_windows(days: int, chunk_days: int = 10) -> list[tuple[datetime, datetime]]:
    """Split a trailing N-day range into request windows that stay well under
    EIA's 5000-row cap (24h x N respondents x fuels)."""
    end = utcnow().replace(minute=0, second=0, microsecond=0)
    start = end - timedelta(days=days)
    windows = []
    cursor = start
    while cursor < end:
        nxt = min(cursor + timedelta(days=chunk_days), end)
        windows.append((cursor, nxt))
        cursor = nxt
    return windows
