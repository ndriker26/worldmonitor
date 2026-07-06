"""Schema-drift behavior: hash changes are logged and adapted, never fatal."""

from __future__ import annotations

import httpx
from sqlalchemy import select

import gridsight.pipeline as pipeline
from gridsight.models import Observation, SchemaSnapshot
from gridsight.pipeline import run_adapter

from conftest import make_ercot_dam_payload
from test_chaos import CannedErcotAdapter


class TestSchemaDrift:
    async def test_first_run_snapshots_schema(self, session_factory, tmp_path, monkeypatch):
        monkeypatch.setattr(pipeline, "PIPELINE_LOG", tmp_path / "PIPELINE_LOG.md")
        adapter = CannedErcotAdapter([make_ercot_dam_payload()])
        async with httpx.AsyncClient() as client:
            hb = await run_adapter(adapter, session_factory, client)
        assert hb.ok
        assert hb.schema_hash
        async with session_factory() as s:
            snap = (await s.execute(select(SchemaSnapshot))).scalar_one()
        assert snap.schema_hash == hb.schema_hash
        assert not (tmp_path / "PIPELINE_LOG.md").exists()  # no drift, no log

    async def test_renamed_field_adapts_via_alias_and_logs(
        self, session_factory, tmp_path, monkeypatch
    ):
        """Upstream renames settlementPointPrice -> SettlementPointPrice.
        The run must succeed (alias resolution) and the drift must be logged."""
        monkeypatch.setattr(pipeline, "PIPELINE_LOG", tmp_path / "PIPELINE_LOG.md")
        original = make_ercot_dam_payload()
        renamed = make_ercot_dam_payload(
            fields=[
                "deliveryDate",
                "hourEnding",
                "settlementPoint",
                "SettlementPointPrice",  # renamed
                "DSTFlag",
            ]
        )
        adapter1 = CannedErcotAdapter([original])
        adapter2 = CannedErcotAdapter([renamed])
        async with httpx.AsyncClient() as client:
            hb1 = await run_adapter(adapter1, session_factory, client)
            hb2 = await run_adapter(adapter2, session_factory, client)

        assert hb1.ok and hb2.ok
        assert hb1.schema_hash != hb2.schema_hash

        log_text = (tmp_path / "PIPELINE_LOG.md").read_text(encoding="utf-8")
        assert "SettlementPointPrice" in log_text
        assert "settlementPointPrice" in log_text  # removed field named in diff

        # Snapshot now reflects the new shape
        async with session_factory() as s:
            snap = (await s.execute(select(SchemaSnapshot))).scalar_one()
        assert snap.schema_hash == hb2.schema_hash

    async def test_unresolvable_removal_fails_run_not_process(
        self, session_factory, tmp_path, monkeypatch
    ):
        """A removed field with no alias fails the run into a heartbeat;
        the process (and the next run) carry on."""
        monkeypatch.setattr(pipeline, "PIPELINE_LOG", tmp_path / "PIPELINE_LOG.md")
        broken = make_ercot_dam_payload(
            fields=["deliveryDate", "hourEnding", "settlementPoint", "priceX", "DSTFlag"]
        )
        adapter = CannedErcotAdapter([make_ercot_dam_payload(), broken, make_ercot_dam_payload()])
        async with httpx.AsyncClient() as client:
            hb1 = await run_adapter(adapter, session_factory, client)
            hb2 = await run_adapter(adapter, session_factory, client)
            hb3 = await run_adapter(adapter, session_factory, client)
        assert hb1.ok
        assert not hb2.ok
        assert "ValidationFailure" in hb2.message
        assert hb3.ok
        # drift was still logged for the broken shape
        assert (tmp_path / "PIPELINE_LOG.md").exists()

    async def test_failed_run_commits_no_rows(self, session_factory, tmp_path, monkeypatch):
        monkeypatch.setattr(pipeline, "PIPELINE_LOG", tmp_path / "PIPELINE_LOG.md")
        broken = make_ercot_dam_payload(
            fields=["deliveryDate", "hourEnding", "settlementPoint", "priceX", "DSTFlag"]
        )
        adapter = CannedErcotAdapter([broken])
        async with httpx.AsyncClient() as client:
            hb = await run_adapter(adapter, session_factory, client)
        assert not hb.ok
        async with session_factory() as s:
            rows = (await s.execute(select(Observation))).scalars().all()
        assert rows == []
