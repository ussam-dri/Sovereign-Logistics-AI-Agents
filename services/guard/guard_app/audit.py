from __future__ import annotations

import hashlib
import json
import os
import uuid
from typing import Any

import psycopg


def audit_conn():
    url = os.environ.get(
        "DATABASE_URL_AUDIT",
        "postgresql://demo:demo_secret_change_me@localhost:5432/sovereignty_audit",
    )
    return psycopg.connect(url)


def write_audit(
    source_org: str,
    target_org: str | None,
    intent: str,
    raw_payload: dict[str, Any],
    sanitized_payload: dict[str, Any] | None,
    policy_id: str,
    action: str,
    allowed_fields: list[str],
    rejected_fields: list[str],
    reason: str,
) -> uuid.UUID:
    raw_hash = hashlib.sha256(
        json.dumps(raw_payload, sort_keys=True, default=str).encode()
    ).hexdigest()
    request_id = uuid.uuid4()
    with audit_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO sharing_requests
                (id, source_org, target_org, intent, raw_payload_hash, sanitized_payload)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    request_id,
                    source_org,
                    target_org,
                    intent,
                    raw_hash,
                    json.dumps(sanitized_payload) if sanitized_payload else None,
                ),
            )
            cur.execute(
                """
                INSERT INTO policy_decisions
                (request_id, policy_id, allowed_fields, rejected_fields, action, reason)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    request_id,
                    policy_id,
                    allowed_fields,
                    rejected_fields,
                    action,
                    reason,
                ),
            )
            cur.execute("SELECT event_hash FROM audit_ledger ORDER BY id DESC LIMIT 1")
            row = cur.fetchone()
            prev_hash = row[0] if row else ""
            event = {
                "request_id": str(request_id),
                "source_org": source_org,
                "action": action,
                "intent": intent,
            }
            event_hash = hashlib.sha256(
                (prev_hash + json.dumps(event, sort_keys=True)).encode()
            ).hexdigest()
            cur.execute(
                """
                INSERT INTO audit_ledger (prev_hash, event_json, event_hash)
                VALUES (%s, %s::jsonb, %s)
                """,
                (prev_hash, json.dumps(event), event_hash),
            )
            conn.commit()
    return request_id
