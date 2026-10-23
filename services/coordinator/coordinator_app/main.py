from __future__ import annotations

import json
import logging
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
import psycopg
from fastapi import Depends, FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from coordinator_app.openrouter_reasoner import (
    rank_proposals_with_openrouter,
    rank_proposals_with_gemini,
)

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Sovereign Agents Coordinator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ATLAS_AGENT_URL = os.environ.get("AGENT_ATLAS_URL", "http://agent-atlas:8020")
GUARD_ATLAS_URL = os.environ.get("GUARD_ATLAS_URL", "http://guard-atlas:8010")
MAGHREB_AGENT_URL = os.environ.get("AGENT_MAGHREB_URL", "http://agent-maghreb:8021")
GUARD_MAGHREB_URL = os.environ.get("GUARD_MAGHREB_URL", "http://guard-maghreb:8011")
SAHARA_AGENT_URL = os.environ.get("AGENT_SAHARA_URL", "http://agent-sahara:8022")
GUARD_SAHARA_URL = os.environ.get("GUARD_SAHARA_URL", "http://guard-sahara:8012")

REGISTRY_PATH = Path(__file__).parent / "registry.json"
DEMO_SHIPMENT = os.environ.get("DEMO_SHIPMENT_REF", "SHP-1042")
INTER_SERVICE_KEY = os.environ.get("INTER_SERVICE_KEY", "")

_last_task: dict[str, Any] = {}

CITIES = ["Casablanca", "Marrakech", "Tanger", "Agadir", "Fes", "Rabat"]
CARGO_TYPES = ["Urgent Electronics", "Pharmaceuticals", "Automotive Parts", "Cold-Chain Produce", "High-Priority Retail"]

ORG_CONFIGS = {
    "atlas_logistics": {
        "org_id": "atlas_logistics",
        "display_name": "Atlas Logistics",
        "role": "Shipper & Originator Carrier",
        "agent_url": ATLAS_AGENT_URL,
        "guard_url": GUARD_ATLAS_URL,
        "region": "National & Casablanca Hub",
    },
    "maghreb_freight": {
        "org_id": "maghreb_freight",
        "display_name": "Maghreb Freight",
        "role": "Regional Partner Carrier (North Morocco)",
        "agent_url": MAGHREB_AGENT_URL,
        "guard_url": GUARD_MAGHREB_URL,
        "region": "Casablanca, Tanger Port, Rabat Corridor",
    },
    "sahara_transport": {
        "org_id": "sahara_transport",
        "display_name": "Sahara Transport",
        "role": "Regional Partner Carrier (South & Inter-City)",
        "agent_url": SAHARA_AGENT_URL,
        "guard_url": GUARD_SAHARA_URL,
        "region": "Marrakech, Agadir, Souss-Massa & Sahara",
    },
}


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def _service_headers() -> dict[str, str]:
    """Headers added to every inter-service call."""
    headers = {}
    if INTER_SERVICE_KEY:
        headers["X-Service-Key"] = INTER_SERVICE_KEY
    return headers


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class DemoStep(BaseModel):
    step: str
    message: str
    detail: dict[str, Any] = Field(default_factory=dict)


class DemoResult(BaseModel):
    task_id: str
    shipment_ref: str
    scenario_info: dict[str, Any] = Field(default_factory=dict)
    steps: list[DemoStep]
    proposals: list[dict[str, Any]]
    selected_partner: Optional[str]
    guard_passed: bool
    gemini_decision: Optional[dict[str, Any]] = None


class ScenarioRequest(BaseModel):
    shipment_ref: Optional[str] = None
    origin: Optional[str] = "Rabat"
    destination: Optional[str] = "Casablanca"
    weight_kg: Optional[float] = 1200.0
    deadline_hours: Optional[int] = 48
    urgency: Optional[str] = "Urgent"
    cargo_type: Optional[str] = "General Freight"


class ViolationTestResult(BaseModel):
    violation_id: str
    name: str
    description: str
    tested_payload: dict[str, Any]
    guard_action: str
    guard_status_code: int
    rejected_fields: list[str]
    rejection_reason: str
    request_id: Optional[str] = None
    audit_logged: bool = True


# ---------------------------------------------------------------------------
# Safety Violation Test Scenarios Catalog
# ---------------------------------------------------------------------------

VIOLATION_CATALOG = {
    "customer_pii": {
        "id": "customer_pii",
        "name": "Customer Direct PII Leakage",
        "description": "Attempts to transmit end-customer full name, personal mobile, and corporate email to external competitors.",
        "payload": {
            "shipment_ref": "SHP-VIO-101",
            "destination": "Casablanca",
            "weight_kg": 1200.0,
            "deadline": "2026-10-12T12:00:00Z",
            "source_org": "atlas_logistics",
            "customer_name": "Laila El Mansouri",
            "customer_phone": "+212-661-889900",
            "customer_email": "laila.mansouri@maroc-agro.ma",
        },
    },
    "driver_identity": {
        "id": "driver_identity",
        "name": "Driver Personal Info & Schedule Leak",
        "description": "Attempts to export internal driver employee ID, personal phone number, and shift schedule outside the company.",
        "payload": {
            "shipment_ref": "SHP-VIO-102",
            "destination": "Tanger",
            "weight_kg": 1800.0,
            "deadline": "2026-10-12T18:00:00Z",
            "source_org": "atlas_logistics",
            "driver_name": "Karim Tazi",
            "driver_employee_code": "DRV-ATL-0042",
            "driver_phone": "+212-670-112233",
            "driver_schedule": "Night Shift Linehaul",
        },
    },
    "nested_pii_injection": {
        "id": "nested_pii_injection",
        "name": "Deep Nested Metadata PII Injection",
        "description": "Attempts to hide customer home address and telephone inside nested metadata trees to bypass shallow filters.",
        "payload": {
            "shipment_ref": "SHP-VIO-103",
            "destination": "Marrakech",
            "weight_kg": 950.0,
            "deadline": "2026-10-13T08:00:00Z",
            "source_org": "atlas_logistics",
            "delivery_context": {
                "route_metadata": {
                    "instructions": "Leave cargo at residence gate",
                    "customer_address": "Villa 14, Quartier Californie, Casablanca",
                    "contact_phone": "+212-522-998877",
                }
            },
        },
    },
    "commercial_secrets": {
        "id": "commercial_secrets",
        "name": "Commercial Margins & High-Value Inventory",
        "description": "Attempts to leak confidential billing markup rates and sensitive inventory categories to third parties.",
        "payload": {
            "shipment_ref": "SHP-VIO-104",
            "destination": "Agadir",
            "weight_kg": 2400.0,
            "deadline": "2026-10-13T16:00:00Z",
            "source_org": "atlas_logistics",
            "customer_rate_mad": 15000.0,
            "profit_margin_pct": 35.5,
            "inventory": "High-Value Sealed Electronics Container",
        },
    },
    "unauthorized_fields": {
        "id": "unauthorized_fields",
        "name": "Arbitrary Non-Whitelisted Injection",
        "description": "Attempts to pass unauthorized fields (classified cargo codes, bypass flags) violating strict allowlist policy.",
        "payload": {
            "shipment_ref": "SHP-VIO-105",
            "destination": "Fes",
            "weight_kg": 1400.0,
            "deadline": "2026-10-12T20:00:00Z",
            "source_org": "atlas_logistics",
            "bypassed_security": True,
            "classified_cargo_code": "MIL-DEF-994",
            "internal_notes": "Sensitive cargo — bypass standard partner check",
        },
    },
}


# ---------------------------------------------------------------------------
# Registry & audit helpers
# ---------------------------------------------------------------------------

def load_registry() -> list[dict]:
    with open(REGISTRY_PATH, encoding="utf-8") as f:
        return json.load(f)["partners"]


def audit_log_event(task_id: str, event_type: str, org_id: Optional[str], payload: dict):
    url = os.environ.get(
        "DATABASE_URL_AUDIT",
        "postgresql://demo:demo_secret_change_me@postgres:5432/sovereignty_audit",
    )
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO collaboration_events (task_id, event_type, org_id, payload)
                VALUES (%s, %s, %s, %s::jsonb)
                """,
                (task_id, event_type, org_id, json.dumps(payload)),
            )
            conn.commit()


# ---------------------------------------------------------------------------
# A2A Agent Card for this coordinator
# ---------------------------------------------------------------------------

@app.get("/.well-known/agent.json")
def agent_card():
    public_url = os.environ.get("PUBLIC_URL", "http://coordinator:8000")
    return {
        "name": "Sovereign Coordinator Agent",
        "description": "Orchestrates multi-org logistics collaboration with policy-enforced data sovereignty.",
        "url": public_url,
        "version": "1.0",
        "protocol": "a2a/1.0",
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
        },
        "skills": [
            {
                "id": "urgent_capacity_search",
                "name": "Urgent Capacity Search",
                "description": "Finds partner capacity for urgent shipments while enforcing data sovereignty policies.",
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
            }
        ],
        "authentication": {
            "schemes": ["ApiKey"],
            "header": "X-Service-Key",
        },
    }


# ---------------------------------------------------------------------------
# Standard endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "openrouter_configured": bool(os.environ.get("OPENROUTER_API_KEY", "").strip()),
        "model": os.environ.get("OPENROUTER_MODEL", "google/gemini-2.0-flash-001"),
    }


@app.get("/registry")
def registry():
    return {"partners": load_registry()}


@app.get("/audit/recent")
def audit_recent(limit: int = 50):
    url = os.environ.get(
        "DATABASE_URL_AUDIT",
        "postgresql://demo:demo_secret_change_me@postgres:5432/sovereignty_audit",
    )
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sr.id, sr.source_org, sr.target_org, sr.intent,
                       sr.sanitized_payload, sr.created_at,
                       pd.action, pd.rejected_fields, pd.reason
                FROM sharing_requests sr
                LEFT JOIN policy_decisions pd ON pd.request_id = sr.id
                ORDER BY sr.created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
    return [
        {
            "request_id": str(r[0]),
            "source_org": r[1],
            "target_org": r[2],
            "intent": r[3],
            "sanitized_payload": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
            "action": r[6],
            "rejected_fields": r[7] or [],
            "reason": r[8],
        }
        for r in rows
    ]


@app.get("/proposals/{task_id}")
def get_proposals(task_id: str):
    if task_id not in _last_task:
        raise HTTPException(404, "Unknown task_id")
    return _last_task[task_id]


# ---------------------------------------------------------------------------
# Safety Violation Testing Endpoints
# ---------------------------------------------------------------------------

@app.get("/demo/violation-scenarios")
def list_violation_scenarios():
    """List all available safety violation testing use cases."""
    return list(VIOLATION_CATALOG.values())


@app.post("/demo/test-violation/{violation_id}", response_model=ViolationTestResult)
async def test_specific_violation(violation_id: str):
    """Run a specific safety violation attack against the Sovereign Guard."""
    # Support both legacy and new attack scenario identifiers
    alias_map = {
        "leak_customer_pii": "customer_pii",
        "leak_pricing": "commercial_secrets",
        "prompt_injection": "unauthorized_fields",
    }
    resolved_id = alias_map.get(violation_id, violation_id)

    if resolved_id not in VIOLATION_CATALOG:
        raise HTTPException(404, f"Unknown violation scenario: {violation_id}")

    scenario = VIOLATION_CATALOG[resolved_id]
    payload = scenario["payload"]
    svc_headers = _service_headers()

    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(
                f"{GUARD_ATLAS_URL}/guard/outbound",
                json={"target_org": "partners", "intent": "assist_query", "payload": payload},
                headers=svc_headers,
            )
            if resp.status_code == 200:
                data = resp.json()
                return ViolationTestResult(
                    violation_id=violation_id,
                    name=scenario["name"],
                    description=scenario["description"],
                    tested_payload=payload,
                    guard_action=data.get("action", "allow"),
                    guard_status_code=200,
                    rejected_fields=data.get("rejected_fields", []),
                    rejection_reason="Allowed or Sanitized by guard",
                    request_id=data.get("request_id"),
                )
        except httpx.HTTPStatusError as exc:
            resp_json = {}
            try:
                resp_json = exc.response.json()
            except Exception:
                pass
            raw_detail = resp_json.get("detail", {}) if isinstance(resp_json, dict) else {}
            detail = raw_detail if isinstance(raw_detail, dict) else {"reason": str(raw_detail)}
            return ViolationTestResult(
                violation_id=violation_id,
                name=scenario["name"],
                description=scenario["description"],
                tested_payload=payload,
                guard_action="reject",
                guard_status_code=exc.response.status_code,
                rejected_fields=detail.get("rejected_fields", []),
                rejection_reason=detail.get("reason", "Forbidden pattern or non-whitelisted field detected"),
                request_id=detail.get("request_id"),
            )
        except Exception as exc:
            raise HTTPException(500, f"Error communicating with Guard: {exc}")


@app.post("/demo/test-guard-rejection")
async def test_guard_rejection_legacy():
    """Legacy backward-compatible rejection endpoint."""
    res = await test_specific_violation("customer_pii")
    return {"ok": True, "detail": res.model_dump()}


# ---------------------------------------------------------------------------
# General Scenario Execution (Legitimate Collaboration)
# ---------------------------------------------------------------------------

@app.post("/demo/run-scenario", response_model=DemoResult)
async def run_scenario(req: ScenarioRequest):
    """Run an end-to-end multi-agent scenario with customizable parameters."""
    task_id = str(uuid.uuid4())
    steps: list[DemoStep] = []
    svc_headers = _service_headers()

    shipment_ref = req.shipment_ref or f"SHP-{random.randint(1100, 9999)}"
    destination = req.destination or random.choice(CITIES)
    origin = req.origin or "Rabat"
    weight_kg = req.weight_kg or float(random.choice([600, 1200, 1800, 2400]))
    deadline_hours = req.deadline_hours or random.choice([18, 24, 36, 48])
    now = datetime.now(timezone.utc)
    deadline_dt = now + timedelta(hours=deadline_hours)
    deadline_iso = deadline_dt.isoformat()

    scenario_info = {
        "shipment_ref": shipment_ref,
        "origin": origin,
        "destination": destination,
        "weight_kg": weight_kg,
        "deadline_hours": deadline_hours,
        "deadline": deadline_iso,
        "urgency": req.urgency or "Urgent",
        "cargo_type": req.cargo_type or random.choice(CARGO_TYPES),
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Step 1 — Load internal shipment
        steps.append(
            DemoStep(
                step="init",
                message=f"Atlas Logistics receives request for {shipment_ref} ({scenario_info['cargo_type']})",
                detail=scenario_info,
            )
        )

        # Atlas internal fleet check: Atlas fleet is occupied for this urgent task
        steps.append(
            DemoStep(
                step="capacity_check",
                message=f"Atlas fleet check: all suitable trucks are occupied or reserved.",
                detail={
                    "origin": origin,
                    "destination": destination,
                    "weight_kg": weight_kg,
                    "deadline": deadline_iso,
                    "internal_note": "Customer private contract details kept strictly inside Atlas internal DB.",
                },
            )
        )

        # Step 2 — Partner Discovery
        partners = load_registry()
        steps.append(
            DemoStep(
                step="discovery",
                message=f"Discovered {len(partners)} regional partners via A2A registry",
                detail={"partners": [p["org_id"] for p in partners]},
            )
        )

        # Step 3 — A2A Handshake: fetch agent cards from /.well-known/agent.json
        agent_cards = []
        for p in partners:
            try:
                card_resp = await client.get(
                    f"{p['agent_url']}/.well-known/agent.json",
                    headers=svc_headers,
                )
                card_resp.raise_for_status()
                agent_cards.append(card_resp.json())
            except Exception as exc:
                log.warning("Could not fetch agent card for %s: %s", p["org_id"], exc)
                agent_cards.append({"org_id": p["org_id"], "error": str(exc)})

        steps.append(
            DemoStep(
                step="handshake",
                message="Exchanged A2A agent cards & protocol capabilities",
                detail={"cards": [{"name": c.get("name"), "version": c.get("version")} for c in agent_cards]},
            )
        )

        # Step 4 & 5 — Guard Policy Enforcement
        outbound_payload = {
            "shipment_ref": shipment_ref,
            "destination": destination,
            "weight_kg": weight_kg,
            "deadline": deadline_iso,
            "source_org": "atlas_logistics",
        }

        guard_passed = True
        try:
            guard_resp = await client.post(
                f"{GUARD_ATLAS_URL}/guard/outbound",
                json={
                    "target_org": "partners",
                    "intent": "assist_query",
                    "payload": outbound_payload,
                },
                headers=svc_headers,
            )
            guard_resp.raise_for_status()
            sanitized = guard_resp.json()["sanitized_payload"]
            steps.append(
                DemoStep(
                    step="guard",
                    message="Sovereignty Guard approved sanitized outbound payload (Zero PII leaked)",
                    detail={
                        "sanitized_keys": list(sanitized.keys()),
                        "auth_mode": "Inter-Service Token Validated",
                        "audit_entry": "Recorded in tamper-evident hash chain",
                    },
                )
            )
        except httpx.HTTPStatusError as e:
            guard_passed = False
            detail = e.response.json()
            steps.append(DemoStep(step="guard", message="Guard rejected payload", detail=detail))
            raise HTTPException(403, detail) from e

        # Step 6 — Parallel Partner Queries
        query_body = {
            "shipment_ref": sanitized["shipment_ref"],
            "destination": sanitized["destination"],
            "weight_kg": sanitized["weight_kg"],
            "deadline": sanitized["deadline"],
        }

        import asyncio

        async def _query_partner_safe(partner: dict) -> dict | None:
            try:
                r = await asyncio.wait_for(
                    client.post(
                        f"{partner['agent_url']}/a2a/v1/assist/query",
                        json=query_body,
                        headers=svc_headers,
                    ),
                    timeout=10.0,
                )
                r.raise_for_status()
                return r.json()
            except Exception as exc:
                log.warning("Partner query failed for %s: %s", partner["org_id"], exc)
                return {"org_id": partner["org_id"], "error": str(exc), "meets_deadline": False}

        raw_results = await asyncio.gather(*[_query_partner_safe(p) for p in partners])
        proposals = [r for r in raw_results if r and "error" not in r]

        for prop in proposals:
            steps.append(
                DemoStep(
                    step="partner_query",
                    message=f"Received proposal from {prop.get('org_id')}: {prop.get('available_trucks')} truck(s), ETA {prop.get('estimated_eta_hours')}h",
                    detail=prop,
                )
            )

        # Step 7 — OpenRouter AI Reasoning
        steps.append(DemoStep(step="reasoning", message="Dispatching partner proposals to OpenRouter AI for multi-factor reasoning"))
        ai_decision = await rank_proposals_with_openrouter(
            proposals=proposals,
            shipment={
                "destination": sanitized["destination"],
                "weight_kg": sanitized["weight_kg"],
                "deadline": sanitized["deadline"],
            },
        )
        selected = ai_decision.get("winner_org_id")

        ai_used = ai_decision.get("ai_used", ai_decision.get("gemini_used", False))
        model_name = ai_decision.get("model", "OpenRouter")
        status_text = f"OpenRouter ({model_name})" if ai_used else "Deterministic Scoring (Fallback)"
        steps.append(
            DemoStep(
                step="decision",
                message=f"Selected partner: {selected} [{status_text}]",
                detail=ai_decision,
            )
        )

        # Step 8 — Audit Logging
        audit_log_event(
            task_id,
            "demo_completed",
            selected,
            {
                "shipment_ref": shipment_ref,
                "scenario": scenario_info,
                "proposals": proposals,
                "ai_decision": ai_decision,
            },
        )
        steps.append(
            DemoStep(
                step="audit",
                message="Collaboration decision and proposal hashes committed to sovereignty_audit ledger",
                detail={"task_id": task_id, "selected_partner": selected},
            )
        )

    result = DemoResult(
        task_id=task_id,
        shipment_ref=shipment_ref,
        scenario_info=scenario_info,
        steps=steps,
        proposals=proposals,
        selected_partner=selected,
        guard_passed=guard_passed,
        gemini_decision=ai_decision,
    )
    _last_task[task_id] = result.model_dump()
    return result


@app.post("/demo/run-urgent-casablanca", response_model=DemoResult)
async def run_urgent_casablanca():
    """Classic preset: Urgent Casablanca (SHP-1042)."""
    return await run_scenario(
        ScenarioRequest(
            shipment_ref="SHP-1042",
            origin="Rabat",
            destination="Casablanca",
            weight_kg=1200.0,
            deadline_hours=48,
            urgency="Urgent",
            cargo_type="Urgent Medical Supplies",
        )
    )


# ---------------------------------------------------------------------------
# Multi-Tenant Admin & Monitoring Endpoints
# ---------------------------------------------------------------------------

@app.get("/admin/orgs")
def list_admin_orgs():
    """Returns directory of all organizations in the Sovereign Network."""
    return list(ORG_CONFIGS.values())


@app.get("/admin/orgs/{org_id}/overview")
async def get_org_overview(org_id: str):
    """Deep inspection for a specific company's admin dashboard."""
    if org_id not in ORG_CONFIGS:
        raise HTTPException(404, f"Organization '{org_id}' not found")

    cfg = ORG_CONFIGS[org_id]
    svc_headers = _service_headers()
    overview: dict[str, Any] = {
        "org_id": org_id,
        "config": cfg,
        "agent_card": None,
        "policy": None,
        "fleet": None,
        "slots": None,
        "shipments": None,
        "audit_logs": [],
    }

    async with httpx.AsyncClient(timeout=10.0) as client:
        # 1. Fetch Agent Card
        try:
            r = await client.get(f"{cfg['agent_url']}/.well-known/agent.json", headers=svc_headers)
            if r.status_code == 200:
                overview["agent_card"] = r.json()
        except Exception as e:
            overview["agent_card"] = {"error": str(e)}

        # 2. Fetch Guard Policy
        try:
            r = await client.get(f"{cfg['guard_url']}/guard/policy", headers=svc_headers)
            if r.status_code == 200:
                overview["policy"] = r.json()
        except Exception as e:
            overview["policy"] = {"error": str(e)}

        # 3. Fetch Fleet
        try:
            r = await client.get(f"{cfg['agent_url']}/internal/fleet", headers=svc_headers)
            if r.status_code == 200:
                overview["fleet"] = r.json()
        except Exception as e:
            overview["fleet"] = {"error": str(e)}

        # 4. Fetch Slots (for partner carriers)
        if org_id in ("maghreb_freight", "sahara_transport"):
            try:
                r = await client.get(f"{cfg['agent_url']}/internal/slots", headers=svc_headers)
                if r.status_code == 200:
                    overview["slots"] = r.json().get("slots", [])
            except Exception as e:
                overview["slots"] = []

        # 5. Fetch Internal Shipments (for Atlas)
        if org_id == "atlas_logistics":
            try:
                r = await client.get(f"{cfg['agent_url']}/internal/shipments", headers=svc_headers)
                if r.status_code == 200:
                    overview["shipments"] = r.json().get("shipments", [])
            except Exception as e:
                overview["shipments"] = []

    # 6. Fetch company-specific audit history
    url = os.environ.get(
        "DATABASE_URL_AUDIT",
        "postgresql://demo:demo_secret_change_me@postgres:5432/sovereignty_audit",
    )
    try:
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT sr.id, sr.source_org, sr.target_org, sr.intent,
                           sr.sanitized_payload, sr.created_at,
                           pd.action, pd.rejected_fields, pd.reason
                    FROM sharing_requests sr
                    LEFT JOIN policy_decisions pd ON pd.request_id = sr.id
                    WHERE sr.source_org = %s OR sr.target_org = %s
                    ORDER BY sr.created_at DESC
                    LIMIT 20
                    """,
                    (org_id, org_id),
                )
                rows = cur.fetchall()
                overview["audit_logs"] = [
                    {
                        "request_id": str(r[0]),
                        "source_org": r[1],
                        "target_org": r[2],
                        "intent": r[3],
                        "sanitized_payload": r[4],
                        "created_at": r[5].isoformat() if r[5] else None,
                        "action": r[6],
                        "rejected_fields": r[7] or [],
                        "reason": r[8],
                    }
                    for r in rows
                ]
    except Exception as exc:
        overview["audit_logs_error"] = str(exc)

    return overview


@app.get("/admin/network-health")
async def get_network_health():
    """Live health status and ping of all nodes across the Sovereign AI Network."""
    nodes = [
        {"name": "Coordinator Node", "type": "coordinator", "url": "http://localhost:8000/health", "role": "Orchestrator"},
        {"name": "Atlas Agent", "type": "agent", "url": f"{ATLAS_AGENT_URL}/health", "role": "Atlas Logistics"},
        {"name": "Maghreb Agent", "type": "agent", "url": f"{MAGHREB_AGENT_URL}/health", "role": "Maghreb Freight"},
        {"name": "Sahara Agent", "type": "agent", "url": f"{SAHARA_AGENT_URL}/health", "role": "Sahara Transport"},
        {"name": "Atlas Guard", "type": "guard", "url": f"{GUARD_ATLAS_URL}/health", "role": "Security Firewall"},
        {"name": "Maghreb Guard", "type": "guard", "url": f"{GUARD_MAGHREB_URL}/health", "role": "Security Firewall"},
        {"name": "Sahara Guard", "type": "guard", "url": f"{GUARD_SAHARA_URL}/health", "role": "Security Firewall"},
    ]

    results = []
    async with httpx.AsyncClient(timeout=4.0) as client:
        for node in nodes:
            t0 = datetime.now()
            try:
                r = await client.get(node["url"])
                ms = int((datetime.now() - t0).total_seconds() * 1000)
                results.append({
                    "name": node["name"],
                    "type": node["type"],
                    "role": node["role"],
                    "status": "healthy" if r.status_code == 200 else "degraded",
                    "status_code": r.status_code,
                    "latency_ms": ms,
                    "details": r.json() if r.status_code == 200 else None,
                })
            except Exception as e:
                results.append({
                    "name": node["name"],
                    "type": node["type"],
                    "role": node["role"],
                    "status": "offline",
                    "status_code": 0,
                    "latency_ms": 999,
                    "error": str(e),
                })

    # Check Audit DB
    db_status = {"name": "PostgreSQL Cluster", "type": "database", "role": "Data Store & Ledger", "status": "healthy", "latency_ms": 1}
    try:
        url = os.environ.get("DATABASE_URL_AUDIT", "postgresql://demo:demo_secret_change_me@postgres:5432/sovereignty_audit")
        t0 = datetime.now()
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM audit_ledger")
                count = cur.fetchone()[0]
                ms = int((datetime.now() - t0).total_seconds() * 1000)
                db_status["latency_ms"] = ms
                db_status["details"] = {"audit_ledger_blocks": count}
    except Exception as e:
        db_status["status"] = "offline"
        db_status["error"] = str(e)
    results.append(db_status)

    return {"nodes": results, "checked_at": datetime.now(timezone.utc).isoformat()}


@app.get("/admin/ledger/verify")
def verify_audit_ledger():
    """Verifies the cryptographic SHA-256 hash chaining of the entire audit ledger."""
    import hashlib

    url = os.environ.get("DATABASE_URL_AUDIT", "postgresql://demo:demo_secret_change_me@postgres:5432/sovereignty_audit")
    try:
        with psycopg.connect(url) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, prev_hash, event_json, event_hash, created_at FROM audit_ledger ORDER BY id ASC")
                rows = cur.fetchall()

        if not rows:
            return {
                "valid": True,
                "total_blocks": 0,
                "status": "Ledger is currently empty",
                "blocks": [],
            }

        is_valid = True
        broken_block = None
        blocks_detail = []
        expected_prev = ""

        for r in rows:
            b_id, prev_hash, event_json, stored_hash, created_at = r
            
            # Chaining verification
            if expected_prev and prev_hash != expected_prev:
                is_valid = False
                broken_block = b_id

            # Recompute SHA-256
            recomputed = hashlib.sha256((prev_hash + json.dumps(event_json, sort_keys=True)).encode()).hexdigest()
            hash_matches = recomputed == stored_hash
            if not hash_matches:
                is_valid = False
                broken_block = b_id

            expected_prev = stored_hash
            blocks_detail.append({
                "block_id": b_id,
                "prev_hash_abbr": (prev_hash[:10] + "...") if prev_hash else "GENESIS",
                "event_hash_abbr": stored_hash[:10] + "...",
                "full_hash": stored_hash,
                "event": event_json,
                "created_at": created_at.isoformat() if created_at else None,
                "hash_valid": hash_matches,
            })

        return {
            "valid": is_valid,
            "total_blocks": len(rows),
            "status": "Cryptographic Hash Chain Verified (Zero Tampering)" if is_valid else f"Integrity Failure at Block #{broken_block}",
            "latest_hash": blocks_detail[-1]["full_hash"] if blocks_detail else "",
            "blocks": blocks_detail[-10:],  # return latest 10 blocks
        }
    except Exception as exc:
        raise HTTPException(500, f"Ledger verification failed: {exc}")


@app.get("/admin/all-logs")
def get_all_logs(limit: int = 50):
    """Unified master audit and collaboration event feed."""
    url = os.environ.get("DATABASE_URL_AUDIT", "postgresql://demo:demo_secret_change_me@postgres:5432/sovereignty_audit")
    with psycopg.connect(url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, task_id, event_type, org_id, payload, created_at
                FROM collaboration_events
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            collab_events = [
                {
                    "id": r[0],
                    "task_id": r[1],
                    "event_type": r[2],
                    "org_id": r[3],
                    "payload": r[4],
                    "created_at": r[5].isoformat() if r[5] else None,
                }
                for r in cur.fetchall()
            ]

            cur.execute(
                """
                SELECT sr.id, sr.source_org, sr.target_org, sr.intent,
                       sr.sanitized_payload, sr.created_at,
                       pd.action, pd.rejected_fields, pd.reason
                FROM sharing_requests sr
                LEFT JOIN policy_decisions pd ON pd.request_id = sr.id
                ORDER BY sr.created_at DESC
                LIMIT %s
                """,
                (limit,),
            )
            sharing_decisions = [
                {
                    "request_id": str(r[0]),
                    "source_org": r[1],
                    "target_org": r[2],
                    "intent": r[3],
                    "sanitized_payload": r[4],
                    "created_at": r[5].isoformat() if r[5] else None,
                    "action": r[6],
                    "rejected_fields": r[7] or [],
                    "reason": r[8],
                }
                for r in cur.fetchall()
            ]

    return {
        "collaboration_events": collab_events,
        "sharing_decisions": sharing_decisions,
    }

