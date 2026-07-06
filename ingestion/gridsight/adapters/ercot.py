"""ERCOT Public API adapter — DAM and RTM settlement point prices.

Code-complete against the documented API (apiexplorer.ercot.com); runs the
moment ERCOT_API_USERNAME / ERCOT_API_PASSWORD / ERCOT_SUBSCRIPTION_KEY land
in .env (registration steps: docs/DATA_ACCESS.md).

API shape (both endpoints):
    {"_meta": {...}, "fields": [{"name": ...}, ...], "data": [[...], ...]}
Records arrive as positional arrays; `fields` gives the column names, which
doubles as our schema-drift signal.

Settlement points: ERCOT has 7 trading hubs and 8 load zones, full stop.
The build prompt asks for "all hubs plus top 20 load zones by volume" —
there aren't 20; we track all 15 hub+zone points. Recorded in BUILD_PLAN.md.

Time: ERCOT publishes in CPT with hour-ending labels and a DSTFlag; all
conversion goes through gridsight.timeutil (see its DST notes).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, ClassVar

import httpx

from ..settings import settings
from ..timeutil import (
    hour_ending_to_utc_start,
    interval_15min_to_utc_start,
    utcnow,
)
from .base import AdapterError, FetchResult, SourceAdapter, ValidationFailure

TOKEN_URL = (
    "https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/"
    "B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token"
)
# Public client id published in ERCOT's API documentation (not a secret).
PUBLIC_CLIENT_ID = "fec253ea-0d06-4272-a5e6-b478baeecd70"
API_BASE = "https://api.ercot.com/api/public-reports"

HUBS = ("HB_BUSAVG", "HB_HOUSTON", "HB_HUBAVG", "HB_NORTH", "HB_PAN", "HB_SOUTH", "HB_WEST")
LOAD_ZONES = ("LZ_AEN", "LZ_CPS", "LZ_HOUSTON", "LZ_LCRA", "LZ_NORTH", "LZ_RAYBN", "LZ_SOUTH", "LZ_WEST")
TRACKED_POINTS = HUBS + LOAD_ZONES

_PRODUCTS = {
    # DAM settlement point prices (hourly)
    "spp_dam": {
        "path": "/np4-190-cd/dam_stlmnt_pnt_prices",
        "series": "spp_dam",
    },
    # RTM settlement point prices (15-min, nodes/zones/hubs)
    "spp_rtm": {
        "path": "/np6-905-cd/spp_node_zone_hub",
        "series": "spp_rtm",
    },
}


def _truthy_dst(value: Any) -> bool:
    return str(value).strip().upper() in {"Y", "YES", "TRUE", "1"}


class ErcotAuth:
    """Azure B2C ROPC token flow with in-memory caching."""

    def __init__(self) -> None:
        self._token: str | None = None
        self._expires_at: datetime | None = None

    def configured(self) -> bool:
        return bool(
            settings.ercot_api_username
            and settings.ercot_api_password
            and settings.ercot_subscription_key
        )

    async def token(self, client: httpx.AsyncClient) -> str:
        if not self.configured():
            raise AdapterError(
                "ERCOT credentials missing — register per docs/DATA_ACCESS.md "
                "and set ERCOT_API_USERNAME / ERCOT_API_PASSWORD / ERCOT_SUBSCRIPTION_KEY"
            )
        now = utcnow()
        if self._token and self._expires_at and now < self._expires_at:
            return self._token
        resp = await client.post(
            TOKEN_URL,
            data={
                "grant_type": "password",
                "username": settings.ercot_api_username,
                "password": settings.ercot_api_password,
                "scope": f"openid {PUBLIC_CLIENT_ID} offline_access",
                "client_id": PUBLIC_CLIENT_ID,
                "response_type": "id_token",
            },
        )
        resp.raise_for_status()
        body = resp.json()
        self._token = body["access_token"]
        from datetime import timedelta

        self._expires_at = now + timedelta(seconds=int(body.get("expires_in", 3600)) - 60)
        return self._token


class ErcotAdapter(SourceAdapter):
    source: ClassVar[str] = "ercot"
    source_tz: ClassVar[str] = "America/Chicago"
    FIELD_ALIASES: ClassVar[dict[str, tuple[str, ...]]] = {
        "deliveryDate": ("DeliveryDate", "delivery_date", "deliveryDt"),
        "hourEnding": ("HourEnding", "hour_ending", "he"),
        "deliveryHour": ("DeliveryHour", "delivery_hour"),
        "deliveryInterval": ("DeliveryInterval", "delivery_interval"),
        "settlementPoint": (
            "SettlementPoint",
            "settlementPointName",
            "SettlementPointName",
            "settlement_point",
        ),
        "settlementPointPrice": (
            "SettlementPointPrice",
            "settlement_point_price",
            "spp",
        ),
        "DSTFlag": ("dstFlag", "dst_flag", "DstFlag"),
    }

    def __init__(self, product: str = "spp_dam", auth: ErcotAuth | None = None) -> None:
        if product not in _PRODUCTS:
            raise ValueError(f"unknown ERCOT product: {product}")
        self.product = product
        self.auth = auth or ErcotAuth()

    async def _get(
        self, client: httpx.AsyncClient, params: dict[str, Any]
    ) -> FetchResult:
        token = await self.auth.token(client)
        started = utcnow()
        resp = await client.get(
            API_BASE + _PRODUCTS[self.product]["path"],
            params=params,
            headers={
                "Authorization": f"Bearer {token}",
                "Ocp-Apim-Subscription-Key": settings.ercot_subscription_key,
            },
        )
        resp.raise_for_status()
        latency = int((utcnow() - started).total_seconds() * 1000)
        return FetchResult(
            endpoint=f"ercot:{self.product}", payload=resp.json(), latency_ms=latency
        )

    async def fetch(self, client: httpx.AsyncClient) -> FetchResult:
        today = utcnow().date()
        return await self._get(
            client,
            {
                "deliveryDateFrom": today.isoformat(),
                "deliveryDateTo": today.isoformat(),
                "size": 5000,
            },
        )

    async def fetch_window(
        self,
        client: httpx.AsyncClient,
        start: date,
        end: date,
        page: int = 1,
    ) -> FetchResult:
        return await self._get(
            client,
            {
                "deliveryDateFrom": start.isoformat(),
                "deliveryDateTo": end.isoformat(),
                "size": 5000,
                "page": page,
            },
        )

    # -- contract ------------------------------------------------------------
    def _columns(self, result: FetchResult) -> list[str]:
        try:
            return [f["name"] for f in result.payload["fields"]]
        except (KeyError, TypeError) as exc:
            raise ValidationFailure(f"ercot: malformed fields block: {exc!r}") from exc

    def records(self, result: FetchResult) -> list[Any]:
        cols = self._columns(result)
        try:
            data = result.payload["data"]
        except (KeyError, TypeError) as exc:
            raise ValidationFailure(f"ercot: missing data block: {exc!r}") from exc
        if not isinstance(data, list):
            raise ValidationFailure("ercot: data is not a list")
        return [dict(zip(cols, row)) for row in data]

    def record_fields(self, result: FetchResult) -> list[str]:
        return sorted(self._columns(result))

    def validate(self, result: FetchResult) -> None:
        for rec in self.records(result)[:5]:
            self.resolve_field(rec, "deliveryDate")
            self.resolve_field(rec, "settlementPoint")
            float(self.resolve_field(rec, "settlementPointPrice"))

    def normalize(self, result: FetchResult) -> list[dict[str, Any]]:
        series = _PRODUCTS[self.product]["series"]
        now = utcnow().replace(tzinfo=None)
        rows: list[dict[str, Any]] = []
        for rec in self.records(result):
            point = str(self.resolve_field(rec, "settlementPoint"))
            if point not in TRACKED_POINTS:
                continue
            delivery = date.fromisoformat(
                str(self.resolve_field(rec, "deliveryDate"))[:10]
            )
            dst = _truthy_dst(rec.get("DSTFlag", rec.get("dstFlag", "N")))
            if self.product == "spp_dam":
                start = hour_ending_to_utc_start(
                    delivery, self.resolve_field(rec, "hourEnding"), dst_flag=dst
                )
                minutes = 60
            else:
                start = interval_15min_to_utc_start(
                    delivery,
                    int(self.resolve_field(rec, "deliveryHour")),
                    int(self.resolve_field(rec, "deliveryInterval")),
                    dst_flag=dst,
                )
                minutes = 15
            rows.append(
                {
                    "source": self.source,
                    "series": series,
                    "node": point,
                    "interval_start": start.replace(tzinfo=None),
                    "interval_minutes": minutes,
                    "value": float(self.resolve_field(rec, "settlementPointPrice")),
                    "unit": "USD/MWh",
                    "source_tz": self.source_tz,
                    "ingested_at": now,
                }
            )
        return rows
