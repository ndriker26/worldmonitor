"""Common adapter interface.

Every source implements the same four verbs — fetch / validate / normalize /
upsert — so the pipeline can drive any of them identically. Field access in
normalize() goes through resolve_field(), which consults FIELD_ALIASES; this
is what lets the pipeline adapt to minor upstream renames instead of
crashing (the drift is still logged by the pipeline).
"""

from __future__ import annotations

import hashlib
import json
from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, ClassVar

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import upsert_observations_versioned


class AdapterError(Exception):
    """Base class for adapter failures the pipeline records but survives."""


class ValidationFailure(AdapterError):
    """Payload is structurally unusable (corrupt JSON, missing fields...)."""


@dataclass
class SchemaDrift:
    endpoint: str
    old_fields: list[str]
    new_fields: list[str]

    @property
    def added(self) -> list[str]:
        return sorted(set(self.new_fields) - set(self.old_fields))

    @property
    def removed(self) -> list[str]:
        return sorted(set(self.old_fields) - set(self.new_fields))


@dataclass
class FetchResult:
    endpoint: str
    payload: Any
    latency_ms: int = 0
    meta: dict[str, Any] = field(default_factory=dict)


def schema_hash(fields: Sequence[str]) -> str:
    return hashlib.sha256(json.dumps(sorted(fields)).encode()).hexdigest()[:16]


class SourceAdapter(ABC):
    source: ClassVar[str]
    source_tz: ClassVar[str] = "UTC"
    # canonical field name -> acceptable upstream alternatives
    FIELD_ALIASES: ClassVar[dict[str, tuple[str, ...]]] = {}

    def resolve_field(self, record: Mapping[str, Any], name: str) -> Any:
        """Fetch a field by canonical name, falling back to aliases and then
        a case-insensitive scan. Raises ValidationFailure when nothing fits.
        """
        if name in record:
            return record[name]
        for alias in self.FIELD_ALIASES.get(name, ()):
            if alias in record:
                return record[alias]
        lowered = {k.lower(): v for k, v in record.items()}
        if name.lower() in lowered:
            return lowered[name.lower()]
        for alias in self.FIELD_ALIASES.get(name, ()):
            if alias.lower() in lowered:
                return lowered[alias.lower()]
        raise ValidationFailure(
            f"{self.source}: field {name!r} missing and no alias matched "
            f"(record keys: {sorted(record.keys())[:12]})"
        )

    @abstractmethod
    async def fetch(self, client: httpx.AsyncClient) -> FetchResult:
        """Pull the latest payload. Must raise (httpx errors pass through)
        rather than return partial data."""

    @abstractmethod
    def validate(self, result: FetchResult) -> None:
        """Raise ValidationFailure if the payload is unusable."""

    @abstractmethod
    def normalize(self, result: FetchResult) -> list[dict[str, Any]]:
        """Convert the payload to observation-row dicts (UTC everywhere)."""

    async def upsert(self, session: AsyncSession, rows: list[dict[str, Any]]) -> int:
        return await upsert_observations_versioned(session, rows)

    def record_fields(self, result: FetchResult) -> list[str]:
        """Field names of one payload record, for schema-drift hashing.
        Adapters with non-mapping payloads override this."""
        records = self.records(result)
        if not records:
            return []
        first = records[0]
        return sorted(first.keys()) if isinstance(first, Mapping) else []

    def records(self, result: FetchResult) -> list[Any]:
        """The list of records inside a payload; adapters override."""
        raise NotImplementedError
