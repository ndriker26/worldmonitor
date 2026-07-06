import pytest

from gridanalyst.costs import BudgetExceeded, actual_cost_usd, check_budget, project_cost_usd
from gridanalyst.model_router import FABLE, HAIKU, SONNET, route


class TestRouting:
    def test_fable_reserved_for_briefs_shock_deep_dives(self):
        assert route("daily_brief").model == FABLE
        assert route("shock_analysis").model == FABLE
        assert route("deep_dive").model == FABLE

    def test_haiku_for_qa(self):
        assert route("heartbeat_check").model == HAIKU
        assert route("data_qa_summary").model == HAIKU

    def test_sonnet_for_user_facing_and_fallback(self):
        assert route("alert_format").model == SONNET
        assert route("user_chat").model == SONNET
        assert route("contract_fallback").model == SONNET

    def test_effort_high_only_for_shock_grade_runs(self):
        assert route("daily_brief").effort == "medium"
        assert route("shock_analysis").effort == "high"

    def test_unknown_task_fails_loudly(self):
        with pytest.raises(KeyError):
            route("vibe_check")


class TestCosts:
    def test_projection_uses_worst_case_output(self):
        # 400k input + 16k output on Fable: 400k*$10/M + 16k*$50/M = $4.80
        assert project_cost_usd(FABLE, 400_000, 16_000) == pytest.approx(4.80)

    def test_cache_reads_cut_projection(self):
        full = project_cost_usd(FABLE, 400_000, 16_000, cached_fraction=0.0)
        mostly_cached = project_cost_usd(FABLE, 400_000, 16_000, cached_fraction=0.9)
        assert mostly_cached < full * 0.5

    def test_budget_abort(self):
        # 700k input + 32k output = $8.60 > $8 hard budget
        projected = project_cost_usd(FABLE, 700_000, 32_000)
        with pytest.raises(BudgetExceeded):
            check_budget(projected)

    def test_budget_allows_normal_run(self):
        check_budget(project_cost_usd(FABLE, 450_000, 16_000))

    def test_actual_cost_includes_cache_tiers(self):
        cost = actual_cost_usd(FABLE, 10_000, 2_000, cache_creation_tokens=300_000, cache_read_tokens=0)
        # 10k*10 + 300k*10*1.25 + 2k*50 = 0.1 + 3.75 + 0.1
        assert cost == pytest.approx(3.95)
