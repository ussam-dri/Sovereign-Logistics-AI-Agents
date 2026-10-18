import os
from datetime import datetime
from typing import Optional

import psycopg
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

ORG_ID = os.environ.get("ORG_ID", "atlas_logistics")
ORG_DISPLAY = os.environ.get("ORG_DISPLAY_NAME", "Atlas Logistics")
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://demo:demo_secret_change_me@localhost:5432/atlas_logistics",
)
INTER_SERVICE_KEY = os.environ.get("INTER_SERVICE_KEY", "")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:8020")

app = FastAPI(title=f"Org Agent — {ORG_DISPLAY}")


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def check_service_key(x_service_key: Optional[str] = Header(default=None)) -> None:
    if not INTER_SERVICE_KEY:
        return  # dev mode
    if x_service_key != INTER_SERVICE_KEY:
        raise HTTPException(401, "Invalid or missing X-Service-Key")


# ---------------------------------------------------------------------------
# A2A Agent Card — served at /.well-known/agent.json (standard A2A discovery)
# ---------------------------------------------------------------------------

@app.get("/.well-known/agent.json")
def agent_card():
    """Standard A2A agent card for partner discovery."""
    return {
        "name": f"{ORG_DISPLAY} Agent",
        "description": f"Logistics capacity and slot query agent for {ORG_DISPLAY}.",
        "url": PUBLIC_URL,
        "version": "1.0",
        "protocol": "a2a/1.0",
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
        },
        "skills": [
            {
                "id": "assist_query",
                "name": "Capacity Assist Query",
                "description": "Query available delivery slots for a destination and weight.",
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
            },
            {
                "id": "fleet_capacity",
                "name": "Fleet Capacity Check",
                "description": "Returns current available truck count.",
                "inputModes": ["application/json"],
                "outputModes": ["application/json"],
            },
        ],
        "authentication": {
            "schemes": ["ApiKey"],
            "header": "X-Service-Key",
        },
    }


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class AssistQueryBody(BaseModel):
    shipment_ref: str
    destination: str
    weight_kg: float
    deadline: datetime


class AssistResponseBody(BaseModel):
    org_id: str
    available_trucks: int
    estimated_eta_hours: float
    cost_estimate: float
    meets_deadline: bool
    slot_summary: str


def get_conn():
    return psycopg.connect(DATABASE_URL)


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "org_id": ORG_ID}


# ---------------------------------------------------------------------------
# A2A assist query endpoint (called by coordinator after Guard sanitizes payload)
# Requires X-Service-Key auth
# ---------------------------------------------------------------------------

@app.post("/internal/assist/query", response_model=AssistResponseBody)
@app.post("/a2a/v1/assist/query", response_model=AssistResponseBody)
def assist_query(
    body: AssistQueryBody,
    x_service_key: Optional[str] = Header(default=None),
):
    check_service_key(x_service_key)

    if ORG_ID == "atlas_logistics":
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) FROM trucks WHERE status = 'available' AND capacity_kg >= %s",
                    (body.weight_kg,),
                )
                avail = cur.fetchone()[0]
        return AssistResponseBody(
            org_id=ORG_ID,
            available_trucks=avail,
            estimated_eta_hours=0,
            cost_estimate=0,
            meets_deadline=False,
            slot_summary="Atlas has no available trucks for this shipment.",
        )

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT trucks_available, eta_hours, cost_estimate, route_name, window_end
                FROM delivery_slots
                WHERE LOWER(destination_city) = LOWER(%s)
                  AND max_weight_kg >= %s
                  AND trucks_available > 0
                  AND window_end >= NOW()
                ORDER BY eta_hours ASC, cost_estimate ASC
                LIMIT 1
                """,
                (body.destination, body.weight_kg),
            )
            row = cur.fetchone()

    if not row:
        return AssistResponseBody(
            org_id=ORG_ID,
            available_trucks=0,
            estimated_eta_hours=999,
            cost_estimate=0,
            meets_deadline=False,
            slot_summary="No matching slots available.",
        )

    trucks_avail, eta, cost, route, window_end = row
    meets = window_end <= body.deadline if window_end else eta <= 48
    return AssistResponseBody(
        org_id=ORG_ID,
        available_trucks=trucks_avail,
        estimated_eta_hours=float(eta),
        cost_estimate=float(cost),
        meets_deadline=bool(meets),
        slot_summary=f"{route}: {trucks_avail} truck(s), ETA {eta}h",
    )


# ---------------------------------------------------------------------------
# Internal shipment lookup (Atlas only — never exposed to partners)
# ---------------------------------------------------------------------------

@app.get("/shipments/{ref}")
def get_shipment_internal(
    ref: str,
    x_service_key: Optional[str] = Header(default=None),
):
    check_service_key(x_service_key)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.external_ref, s.origin, s.destination, s.weight_kg, s.deadline, s.status,
                       c.full_name, c.phone
                FROM shipments s
                JOIN customers c ON c.id = s.customer_id
                WHERE s.external_ref = %s
                """,
                (ref,),
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Shipment not found")
    return {
        "external_ref": row[0],
        "origin": row[1],
        "destination": row[2],
        "weight_kg": float(row[3]),
        "deadline": row[4].isoformat(),
        "status": row[5],
        "customer_name": row[6],
        "customer_phone": row[7],
        "_warning": "INTERNAL ONLY — contains PII, never share externally",
    }


# ---------------------------------------------------------------------------
# Internal Admin Data Endpoints (for Company Admin Dashboards)
# ---------------------------------------------------------------------------

@app.get("/internal/fleet")
def get_fleet_internal(x_service_key: Optional[str] = Header(default=None)):
    check_service_key(x_service_key)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, plate_code, capacity_kg, status, current_location, internal_notes
                FROM trucks
                ORDER BY id ASC
                LIMIT 50
                """
            )
            rows = cur.fetchall()
            cur.execute(
                """
                SELECT status, COUNT(*)
                FROM trucks
                GROUP BY status
                """
            )
            counts = dict(cur.fetchall())
    trucks = [
        {
            "id": r[0],
            "plate_code": r[1],
            "capacity_kg": float(r[2]),
            "status": r[3],
            "current_location": r[4],
            "internal_notes": r[5] or "",
        }
        for r in rows
    ]
    return {
        "org_id": ORG_ID,
        "org_display_name": ORG_DISPLAY,
        "total_trucks": len(trucks),
        "status_counts": counts,
        "trucks": trucks,
    }


@app.get("/internal/slots")
def get_slots_internal(x_service_key: Optional[str] = Header(default=None)):
    check_service_key(x_service_key)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, route_name, destination_city, window_start, window_end,
                       max_weight_kg, trucks_available, cost_estimate, eta_hours
                FROM delivery_slots
                WHERE window_end >= NOW()
                ORDER BY window_start ASC
                LIMIT 50
                """
            )
            rows = cur.fetchall()
    return {
        "org_id": ORG_ID,
        "org_display_name": ORG_DISPLAY,
        "slots": [
            {
                "id": r[0],
                "route_name": r[1],
                "destination_city": r[2],
                "window_start": r[3].isoformat() if r[3] else None,
                "window_end": r[4].isoformat() if r[4] else None,
                "max_weight_kg": float(r[5]),
                "trucks_available": r[6],
                "cost_estimate": float(r[7]),
                "eta_hours": float(r[8]),
            }
            for r in rows
        ],
    }


@app.get("/internal/shipments")
def get_shipments_internal(x_service_key: Optional[str] = Header(default=None)):
    check_service_key(x_service_key)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s.id, s.external_ref, s.origin, s.destination, s.weight_kg,
                       s.deadline, s.status, c.full_name, c.phone
                FROM shipments s
                LEFT JOIN customers c ON c.id = s.customer_id
                ORDER BY s.id DESC
                LIMIT 50
                """
            )
            rows = cur.fetchall()
    return {
        "org_id": ORG_ID,
        "org_display_name": ORG_DISPLAY,
        "shipments": [
            {
                "id": r[0],
                "external_ref": r[1],
                "origin": r[2],
                "destination": r[3],
                "weight_kg": float(r[4]),
                "deadline": r[5].isoformat() if r[5] else None,
                "status": r[6],
                "customer_name": r[7] or "Unknown",
                "customer_phone": r[8] or "—",
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# Legacy /capabilities endpoint (kept for backward compat)
# ---------------------------------------------------------------------------

@app.get("/capabilities")
def capabilities():
    return {
        "name": f"{ORG_DISPLAY} Agent",
        "org_id": ORG_ID,
        "description": "Logistics assist agent.",
        "capabilities": ["assist_query", "fleet_capacity"],
        "endpoint": PUBLIC_URL,
        "version": "a2a/1.0",
    }

