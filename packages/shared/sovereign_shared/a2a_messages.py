"""Simulated A2A-shaped messages (v1); swap transport for a2a-sdk later."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from sovereign_shared.models import OrgId


class AgentCard(BaseModel):
    name: str
    org_id: OrgId
    description: str
    capabilities: list[str] = Field(default_factory=list)
    endpoint: str
    version: str = "simulated-a2a-1.0"


class TaskMessage(BaseModel):
    task_id: str
    intent: str
    payload: dict[str, Any]


class AssistQuery(BaseModel):
    shipment_ref: str
    destination: str
    weight_kg: float
    deadline: datetime


class AssistResponse(BaseModel):
    org_id: OrgId
    available_trucks: int
    estimated_eta_hours: float
    cost_estimate: float
    meets_deadline: bool
    slot_summary: str
