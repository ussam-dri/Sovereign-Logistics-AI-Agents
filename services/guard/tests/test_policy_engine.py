import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from guard_app.policy_engine import evaluate_payload, load_policy  # noqa: E402

POLICIES = Path(__file__).resolve().parents[1] / "policies"


def test_allow_sanitized_request():
    policy = load_policy(str(POLICIES / "atlas_outbound.yaml"))
    payload = {
        "shipment_ref": "SHP-1042",
        "destination": "Casablanca",
        "weight_kg": 1200,
        "deadline": "2026-10-11T12:00:00Z",
        "source_org": "atlas_logistics",
    }
    result = evaluate_payload(payload, policy)
    assert result.action in ("allow", "sanitize")
    assert "customer_name" not in result.sanitized


def test_reject_customer_name():
    policy = load_policy(str(POLICIES / "atlas_outbound.yaml"))
    payload = {
        "shipment_ref": "SHP-1042",
        "destination": "Casablanca",
        "weight_kg": 1200,
        "deadline": "2026-10-11T12:00:00Z",
        "customer_name": "Fictional Person",
    }
    result = evaluate_payload(payload, policy)
    assert result.action == "reject"


def test_nested_forbidden():
    policy = load_policy(str(POLICIES / "atlas_outbound.yaml"))
    payload = {
        "shipment_ref": "SHP-1042",
        "destination": "Casablanca",
        "weight_kg": 1200,
        "deadline": "2026-10-11T12:00:00Z",
        "meta": {"customer_phone": "555-0100"},
    }
    result = evaluate_payload(payload, policy)
    assert result.action == "reject"
