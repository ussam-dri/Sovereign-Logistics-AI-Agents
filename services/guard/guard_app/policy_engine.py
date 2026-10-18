from __future__ import annotations

import fnmatch
import hashlib
import json
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

import yaml


@dataclass
class PolicyResult:
    action: str
    sanitized: dict[str, Any]
    allowed_fields: list[str]
    rejected_fields: list[str]
    reason: str
    policy_id: str


def load_policy(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _flatten_keys(obj: Any, prefix: str = "") -> list[str]:
    keys: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            full = f"{prefix}.{k}" if prefix else k
            keys.append(full)
            keys.extend(_flatten_keys(v, full))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            keys.extend(_flatten_keys(item, f"{prefix}[{i}]"))
    return keys


def _key_matches_pattern(key: str, pattern: str) -> bool:
    base = key.split(".")[0].split("[")[0]
    return fnmatch.fnmatch(key, pattern) or fnmatch.fnmatch(base, pattern)


def _remove_forbidden(obj: Any, forbidden: list[str]) -> tuple[Any, list[str]]:
    removed: list[str] = []

    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if any(_key_matches_pattern(k, p) for p in forbidden):
                removed.append(k)
                continue
            cleaned, sub = _remove_forbidden(v, forbidden)
            removed.extend(sub)
            out[k] = cleaned
        return out, removed

    if isinstance(obj, list):
        out_list = []
        for item in obj:
            cleaned, sub = _remove_forbidden(item, forbidden)
            removed.extend(sub)
            out_list.append(cleaned)
        return out_list, removed

    return obj, removed


def evaluate_payload(payload: dict[str, Any], policy: dict) -> PolicyResult:
    policy_id = policy.get("policy_id", "unknown")
    allowed = policy.get("allowed_fields", [])
    forbidden = policy.get("forbidden_patterns", [])
    on_violation = policy.get("on_violation", "reject")

    payload_keys = _flatten_keys(payload)
    top_level = set(payload.keys())
    rejected = [k for k in top_level if k not in allowed]
    forbidden_hits = [k for k in payload_keys if any(_key_matches_pattern(k, p) for p in forbidden)]

    all_rejected = sorted(set(rejected + forbidden_hits))

    if forbidden_hits and on_violation == "reject":
        return PolicyResult(
            action="reject",
            sanitized={},
            allowed_fields=allowed,
            rejected_fields=all_rejected,
            reason="Forbidden field patterns detected",
            policy_id=policy_id,
        )

    if rejected and on_violation == "reject":
        return PolicyResult(
            action="reject",
            sanitized={},
            allowed_fields=allowed,
            rejected_fields=all_rejected,
            reason="Fields not in allow list",
            policy_id=policy_id,
        )

    sanitized = {k: deepcopy(payload[k]) for k in payload if k in allowed}
    sanitized, stripped = _remove_forbidden(sanitized, forbidden)
    if stripped or rejected:
        return PolicyResult(
            action="sanitize",
            sanitized=sanitized,
            allowed_fields=allowed,
            rejected_fields=sorted(set(all_rejected + stripped)),
            reason="Removed non-allowed or forbidden fields",
            policy_id=policy_id,
        )

    return PolicyResult(
        action="allow",
        sanitized=sanitized,
        allowed_fields=allowed,
        rejected_fields=[],
        reason="All fields permitted",
        policy_id=policy_id,
    )


def payload_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()
