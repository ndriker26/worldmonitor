"""NOAA api.weather.gov adapter — hourly forecast temperature and wind for
representative points in each ERCOT load zone. No API key; the service asks
only for an identifying User-Agent.

Load is driven by temperature; West-zone wind speed matters because ERCOT
West is wind-heavy. One representative city per zone is deliberately crude —
good enough for the analyst's context, cheap to fetch, easy to upgrade to
population-weighted points later.
"""

from __future__ import annotations

from typing import Any, ClassVar

import httpx

from ..settings import settings
from ..timeutil import parse_iso_utc, utcnow
from .base import FetchResult, SourceAdapter, ValidationFailure

# ERCOT load zone -> representative (lat, lon)
ZONE_POINTS: dict[str, tuple[float, float]] = {
    "LZ_HOUSTON": (29.76, -95.36),   # Houston
    "LZ_NORTH": (32.78, -96.80),     # Dallas
    "LZ_SOUTH": (27.80, -97.40),     # Corpus Christi
    "LZ_WEST": (31.99, -102.08),     # Midland
    "LZ_AEN": (30.27, -97.74),       # Austin
    "LZ_CPS": (29.42, -98.49),       # San Antonio
    "LZ_LCRA": (30.57, -98.27),      # Marble Falls
    "LZ_RAYBN": (33.66, -95.55),     # Paris, TX
}

API_BASE = "https://api.weather.gov"


class NoaaAdapter(SourceAdapter):
    source: ClassVar[str] = "noaa"
    source_tz: ClassVar[str] = "UTC"  # timestamps arrive offset-aware
    FIELD_ALIASES: ClassVar[dict[str, tuple[str, ...]]] = {
        "startTime": ("start_time", "validTime"),
        "temperature": ("temp",),
        "windSpeed": ("wind_speed",),
    }

    def __init__(self, zones: dict[str, tuple[float, float]] | None = None) -> None:
        self.zones = zones or ZONE_POINTS
        self._grid_urls: dict[str, str] = {}  # zone -> forecastHourly URL

    def _headers(self) -> dict[str, str]:
        return {"User-Agent": settings.noaa_user_agent, "Accept": "application/geo+json"}

    async def _grid_url(self, client: httpx.AsyncClient, zone: str) -> str:
        if zone not in self._grid_urls:
            lat, lon = self.zones[zone]
            resp = await client.get(
                f"{API_BASE}/points/{lat},{lon}", headers=self._headers()
            )
            resp.raise_for_status()
            self._grid_urls[zone] = resp.json()["properties"]["forecastHourly"]
        return self._grid_urls[zone]

    async def fetch(self, client: httpx.AsyncClient) -> FetchResult:
        started = utcnow()
        by_zone: dict[str, Any] = {}
        for zone in self.zones:
            url = await self._grid_url(client, zone)
            resp = await client.get(url, headers=self._headers())
            resp.raise_for_status()
            by_zone[zone] = resp.json()
        latency = int((utcnow() - started).total_seconds() * 1000)
        return FetchResult(endpoint="noaa:forecast_hourly", payload=by_zone, latency_ms=latency)

    # -- contract ------------------------------------------------------------
    def records(self, result: FetchResult) -> list[Any]:
        records = []
        try:
            for zone, doc in result.payload.items():
                for period in doc["properties"]["periods"]:
                    records.append({"zone": zone, **period})
        except (KeyError, TypeError) as exc:
            raise ValidationFailure(f"noaa: malformed forecast payload: {exc!r}") from exc
        return records

    def validate(self, result: FetchResult) -> None:
        records = self.records(result)
        if not records:
            raise ValidationFailure("noaa: no forecast periods returned")
        for rec in records[:5]:
            parse_iso_utc(str(self.resolve_field(rec, "startTime")))
            float(self.resolve_field(rec, "temperature"))

    @staticmethod
    def _wind_mph(raw: Any) -> float | None:
        # windSpeed arrives as "10 mph" or "10 to 15 mph"; take the max.
        try:
            parts = [p for p in str(raw).split() if p.replace(".", "").isdigit()]
            return float(parts[-1]) if parts else None
        except (ValueError, IndexError):
            return None

    def normalize(self, result: FetchResult) -> list[dict[str, Any]]:
        now = utcnow().replace(tzinfo=None)
        rows: list[dict[str, Any]] = []
        for rec in self.records(result):
            start = parse_iso_utc(str(self.resolve_field(rec, "startTime")))
            zone = rec["zone"]
            common = {
                "source": self.source,
                "node": zone,
                "interval_start": start.replace(tzinfo=None),
                "interval_minutes": 60,
                "source_tz": self.source_tz,
                "ingested_at": now,
            }
            rows.append(
                {
                    **common,
                    "series": "fcst_temp",
                    "value": float(self.resolve_field(rec, "temperature")),
                    "unit": str(rec.get("temperatureUnit", "F")),
                }
            )
            wind = self._wind_mph(rec.get("windSpeed"))
            if wind is not None:
                rows.append(
                    {**common, "series": "fcst_wind", "value": wind, "unit": "mph"}
                )
        return rows
