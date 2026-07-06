"""Runtime configuration. Reads env vars, falling back to the repo .env."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# ingestion/gridsight/settings.py -> repo root two levels up
_REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _REPO_ROOT / ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # SQLite locally; set DATABASE_URL=postgresql+asyncpg://... in production.
    database_url: str = f"sqlite+aiosqlite:///{(_REPO_ROOT / 'ingestion' / 'gridsight.db').as_posix()}"

    # EIA v2 — key present in repo .env and verified working (see docs/DATA_ACCESS.md)
    eia_api_key: str = ""

    # ERCOT Public API — registration pending (docs/DATA_ACCESS.md)
    ercot_api_username: str = ""
    ercot_api_password: str = ""
    ercot_subscription_key: str = ""

    # NOAA needs no key, only a contact User-Agent per api.weather.gov policy.
    noaa_user_agent: str = "gridseyeview.com ingestion (natantheskier@gmail.com)"

    # PJM — stub until registration (docs/DATA_ACCESS.md)
    pjm_api_key: str = ""

    # Pipeline cadence
    fetch_interval_seconds: int = 300
    request_timeout_seconds: float = 30.0


settings = Settings()
