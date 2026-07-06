"""MISO adapter — intentional stub.

MISO exposes public JSON endpoints (no key) but is out of scope until the
ERCOT pipeline is proven. Kept so the routing/scheduling tables have a slot.
"""

from __future__ import annotations

from typing import Any, ClassVar

import httpx

from .base import AdapterError, FetchResult, SourceAdapter


class MisoAdapter(SourceAdapter):
    source: ClassVar[str] = "miso"
    source_tz: ClassVar[str] = "America/Chicago"  # EST-fixed for markets; revisit when implemented

    async def fetch(self, client: httpx.AsyncClient) -> FetchResult:
        raise AdapterError("MISO adapter is a stub — scheduled for a later phase")

    def validate(self, result: FetchResult) -> None:  # pragma: no cover
        raise NotImplementedError

    def normalize(self, result: FetchResult) -> list[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError
