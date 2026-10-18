import os
from typing import Any, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from guard_app.audit import write_audit
from guard_app.auth import verify_partner_jwt, verify_service_key
from guard_app.policy_engine import evaluate_payload, load_policy

app = FastAPI(title="Sovereignty Guard (Real Auth)")

POLICY_PATH = os.environ.get("POLICY_PATH", "/app/policies/atlas_outbound.yaml")
SOURCE_ORG = os.environ.get("SOURCE_ORG", "atlas_logistics")


class OutboundRequest(BaseModel):
    target_org: Optional[str] = None
    intent: str = "assist_query"
    payload: dict[str, Any] = Field(default_factory=dict)


class OutboundResponse(BaseModel):
    action: str
    sanitized_payload: dict[str, Any]
    rejected_fields: list[str]
    request_id: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok", "source_org": SOURCE_ORG}


@app.get("/guard/policy")
def get_guard_policy():
    policy = load_policy(POLICY_PATH)
    return {
        "source_org": SOURCE_ORG,
        "policy_id": getattr(policy, "policy_id", "default"),
        "allowed_fields": getattr(policy, "allowed_fields", []),
        "forbidden_patterns": getattr(policy, "forbidden_patterns", []),
        "on_violation": getattr(policy, "on_violation", "reject"),
    }


@app.post(
    "/guard/outbound",
    response_model=OutboundResponse,
    dependencies=[Depends(verify_service_key)],  # internal-only: requires X-Service-Key
)
def guard_outbound(body: OutboundRequest):
    policy = load_policy(POLICY_PATH)
    result = evaluate_payload(body.payload, policy)
    request_id = write_audit(
        source_org=SOURCE_ORG,
        target_org=body.target_org,
        intent=body.intent,
        raw_payload=body.payload,
        sanitized_payload=result.sanitized if result.action != "reject" else None,
        policy_id=result.policy_id,
        action=result.action,
        allowed_fields=result.allowed_fields,
        rejected_fields=result.rejected_fields,
        reason=result.reason,
    )
    if result.action == "reject":
        raise HTTPException(
            status_code=403,
            detail={
                "action": "reject",
                "rejected_fields": result.rejected_fields,
                "reason": result.reason,
                "request_id": str(request_id),
            },
        )
    return OutboundResponse(
        action=result.action,
        sanitized_payload=result.sanitized,
        rejected_fields=result.rejected_fields,
        request_id=str(request_id),
    )
