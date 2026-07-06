"""PJM adapter — intentional stub.

PJM Data Miner 2 requires a free API key (https://apiportal.pjm.com/, see
docs/DATA_ACCESS.md). Until registration, this stub keeps the interface
shape and fails loudly if scheduled.
"""

from __future__ import annotations

from typing import Any, ClassVar

import httpx

from .base import AdapterError, FetchResult, SourceAdapter


class PjmAdapter(SourceAdapter):
    source: ClassVar[str] = "pjm"
    source_tz: ClassVar[str] = "America/New_York"  # EPT

    async def fetch(self, client: httpx.AsyncClient) -> FetchResult:
        raise AdapterError(
            "PJM adapter is a stub — register at https://apiportal.pjm.com/ "
            "and set PJM_API_KEY (docs/DATA_ACCESS.md) before scheduling it"
        )

    def validate(self, result: FetchResult) -> None:  # pragma: no cover
        raise NotImplementedError

    def normalize(self, result: FetchResult) -> list[dict[str, Any]]:  # pragma: no cover
        raise NotImplementedError
