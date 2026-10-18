from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class OrgId(str, Enum):
    ATLAS = "atlas_logistics"
    MAGHREB = "maghreb_freight"
    SAHARA = "sahara_transport"


class PolicyAction(str, Enum):
    ALLOW = "allow"
    SANITIZE = "sanitize"
    REJECT = "reject"


class SanitizedAssistRequest(BaseModel):
    shipment_ref: str
    destination: str
    weight_kg: float
    deadline: datetime
    source_org: OrgId


class Proposal(BaseModel):
    partner_org: OrgId
    available_trucks: int
    estimated_eta_hours: float
    cost_estimate: float
    meets_deadline: bool
    score: float = 0.0
    slot_summary: str = ""


class TaskStep(str, Enum):
    INIT = "init"
    DISCOVERY = "discovery"
    HANDSHAKE = "handshake"
    GUARD = "guard"
    PARTNER_QUERY = "partner_query"
    COMPARE = "compare"
    AUDIT = "audit"
    DONE = "done"


class DemoStepEvent(BaseModel):
    step: TaskStep
    message: str
    detail: dict[str, Any] = Field(default_factory=dict)


class CollaborationOutcome(BaseModel):
    task_id: str
    shipment_ref: str
    selected_partner: OrgId | None
    proposals: list[Proposal]
    steps: list[DemoStepEvent]
    guard_passed: bool = True
