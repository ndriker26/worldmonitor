import json

import pytest

from gridanalyst.contract import ContractViolation, validate


def good_output() -> dict:
    return {
        "market_state": "elevated",
        "headline": "West hub prices doubled on a wind lull during peak heat.",
        "causal_chain": [
            "fcst_temp LZ_WEST 2026-07-05T21Z hit 104F (evidence: weather section)",
            "fuel_mix.WND fell from 18,200 to 6,100 MWh between 18Z and 21Z",
            "HB_WEST spp_dam printed 145.20 at 21Z vs 30-day hour-of-day mean 52.10",
        ],
        "affected_nodes": [
            {
                "node": "HB_WEST",
                "current_price": 145.2,
                "expected_range": [35.0, 70.0],
                "deviation_sigma": 3.4,
            }
        ],
        "duration_estimate": {"hours": 6, "confidence": "med", "basis": "wind forecast recovers overnight"},
        "historical_analogs": [
            {"date": "2026-06-14", "similarity": "same wind-lull-plus-heat shape", "how_it_resolved": "prices normalized within 8 hours"}
        ],
        "tradeable_thesis": "Short the West-North basis into tomorrow's DAM; wind recovery is priced but heat persistence is not.",
        "self_grade_prior": "Predicted HB_WEST stays above 100 through 03Z; grade against 03Z print.",
    }


class TestValidOutput:
    def test_accepts_valid_dict(self):
        assert validate(good_output())["market_state"] == "elevated"

    def test_accepts_valid_json_string(self):
        assert validate(json.dumps(good_output()))["headline"]

    def test_no_edge_is_valid(self):
        out = good_output()
        out["tradeable_thesis"] = "no edge"
        out["market_state"] = "normal"
        validate(out)


class TestViolations:
    def test_invalid_json(self):
        with pytest.raises(ContractViolation, match="not valid JSON"):
            validate("{not json")

    def test_bad_market_state(self):
        out = good_output()
        out["market_state"] = "panic"
        with pytest.raises(ContractViolation, match="market_state"):
            validate(out)

    def test_missing_required_field(self):
        out = good_output()
        del out["self_grade_prior"]
        with pytest.raises(ContractViolation):
            validate(out)

    def test_extra_field_rejected(self):
        out = good_output()
        out["vibes"] = "immaculate"
        with pytest.raises(ContractViolation):
            validate(out)

    def test_bad_confidence(self):
        out = good_output()
        out["duration_estimate"]["confidence"] = "certain"
        with pytest.raises(ContractViolation):
            validate(out)

    def test_expected_range_must_be_low_high_pair(self):
        out = good_output()
        out["affected_nodes"][0]["expected_range"] = [70.0, 35.0]
        with pytest.raises(ContractViolation, match="expected_range"):
            validate(out)

    def test_expected_range_wrong_length(self):
        out = good_output()
        out["affected_nodes"][0]["expected_range"] = [35.0]
        with pytest.raises(ContractViolation, match="expected_range"):
            validate(out)
