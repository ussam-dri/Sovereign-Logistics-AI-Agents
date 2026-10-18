"""OpenRouter AI proposal ranking for the Sovereign Coordinator.

Connects to OpenRouter (https://openrouter.ai/api/v1/chat/completions) to reason
across multi-partner logistics proposals using any LLM (e.g. Google Gemini,
Claude, Llama 3.3, DeepSeek, GPT-4o).

Features:
- OpenAI-compatible chat completion via httpx
- JSON structured output enforcement & robust markdown stripper
- 15-minute response caching to conserve tokens
- Transparent diagnostic reporting on status, model, and errors
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from typing import Any, Optional

import httpx
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.0-flash-001")
OPENROUTER_BASE_URL = os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

# In-memory caching & rate limiting
_cache: dict[str, tuple[float, dict[str, Any]]] = {}  # key -> (timestamp, result_dict)
_lock = asyncio.Lock()


class RankingDecision(BaseModel):
    winner_org_id: str = Field(description="org_id of the selected partner")
    confidence: float = Field(description="Confidence score 0.0-1.0")
    reasoning: str = Field(description="2-3 sentence explanation of the choice")
    risks: list[str] = Field(description="Key risks with the chosen partner")
    fallback_org_id: Optional[str] = Field(
        default=None,
        description="org_id of the recommended fallback if winner fails",
    )


def _compute_cache_key(proposals: list[dict], shipment: dict) -> str:
    """Create a hash based on the shipment route, weight, and proposal values."""
    simplified_proposals = sorted(
        [
            (
                p.get("org_id"),
                p.get("available_trucks"),
                p.get("estimated_eta_hours"),
                p.get("cost_estimate"),
                p.get("meets_deadline"),
            )
            for p in proposals
        ],
        key=lambda x: str(x[0]),
    )
    raw = json.dumps(
        {
            "dest": shipment.get("destination", "").lower(),
            "wt": float(shipment.get("weight_kg", 0)),
            "props": simplified_proposals,
        },
        sort_keys=True,
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _score_fallback(
    proposals: list[dict],
    reason_not_used: str,
    ai_error: Optional[str] = None,
) -> dict:
    """Deterministic formula fallback when OpenRouter AI cannot be invoked."""
    def _score(p: dict) -> float:
        s = 0.0
        if p.get("meets_deadline"):
            s += 1000
        s -= float(p.get("estimated_eta_hours", 999)) * 10
        s -= float(p.get("cost_estimate", 0)) * 0.01
        s += float(p.get("available_trucks", 0)) * 5
        return s

    ranked = sorted(proposals, key=_score, reverse=True)
    winner = ranked[0] if ranked else None
    fallback = ranked[1] if len(ranked) > 1 else None
    return {
        "winner_org_id": winner["org_id"] if winner else None,
        "confidence": 0.75,
        "reasoning": "Selected by deterministic formula ranking (OpenRouter AI fallback active).",
        "risks": [
            "Formula-based evaluation without contextual risk assessment",
            f"Notice: {reason_not_used}",
        ],
        "fallback_org_id": fallback["org_id"] if fallback else None,
        "ai_used": False,
        "gemini_used": False,  # backward compatibility with frontend
        "provider": "openrouter",
        "reason_not_used": reason_not_used,
        "ai_error": ai_error,
        "gemini_error": ai_error,  # backward compatibility
        "cached": False,
        "model": None,
    }


def _extract_json(text: str) -> dict:
    """Extract JSON object from model output even if wrapped in markdown fences."""
    text = text.strip()
    # Strip markdown ```json ... ```
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        text = m.group(1)
    else:
        # Try finding outer brackets { ... }
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            text = text[start : end + 1]
    return json.loads(text)


async def rank_proposals_with_openrouter(
    proposals: list[dict[str, Any]],
    shipment: dict[str, Any],
) -> dict[str, Any]:
    """Use OpenRouter to reason about partner proposals."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    model_name = os.environ.get("OPENROUTER_MODEL", "google/gemini-2.0-flash-001").strip()

    if not api_key or api_key == "your_openrouter_api_key_here":
        reason = "OPENROUTER_API_KEY is not configured in .env or environment"
        log.warning("OpenRouter skipped: %s", reason)
        return _score_fallback(proposals, reason_not_used=reason)

    # 1. Check in-memory cache
    cache_key = _compute_cache_key(proposals, shipment)
    now = time.time()
    if cache_key in _cache:
        cached_time, cached_val = _cache[cache_key]
        if now - cached_time < 900:  # 15 min cache
            log.info("OpenRouter decision served from cache (key=%s)", cache_key)
            result = dict(cached_val)
            result["cached"] = True
            return result

    # 2. Build OpenRouter Chat Completion Prompt
    proposals_text = json.dumps(
        [
            {
                "org_id": p.get("org_id"),
                "available_trucks": p.get("available_trucks"),
                "estimated_eta_hours": p.get("estimated_eta_hours"),
                "cost_estimate": p.get("cost_estimate"),
                "meets_deadline": p.get("meets_deadline"),
                "slot_summary": p.get("slot_summary", ""),
            }
            for p in proposals
        ],
        indent=2,
    )

    system_prompt = (
        "You are an expert autonomous logistics coordinator AI. Your task is to evaluate "
        "competing capacity proposals from regional carrier agents and pick the optimal winner.\n"
        "You MUST respond ONLY with a valid JSON object matching this exact schema:\n"
        "{\n"
        '  "winner_org_id": "string",\n'
        '  "confidence": 0.95,\n'
        '  "reasoning": "2-3 sentences explaining the choice based on deadline, ETA, cost, and truck capacity.",\n'
        '  "risks": ["Risk 1", "Risk 2"],\n'
        '  "fallback_org_id": "string or null"\n'
        "}"
    )

    user_prompt = f"""Shipment Requirements:
- Destination: {shipment.get('destination')}
- Weight: {shipment.get('weight_kg')} kg
- Deadline: {shipment.get('deadline')}
- Urgency: High (All internal fleet occupied)

Partner Proposals Received via A2A:
{proposals_text}

Selection Criteria Priorities:
1. Meets Deadline (non-negotiable primary requirement)
2. Lowest ETA hours (speed)
3. Cost efficiency
4. Redundancy (trucks available > 1 lowers cancellation risk)

Respond in JSON only."""

    headers = {
        "Authorization": f"Bearer {api_key}",
        "HTTP-Referer": os.environ.get("PUBLIC_URL", "http://localhost:8000"),
        "X-Title": "Sovereign AI Multi-Agent Network",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            response = await client.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            raw_content = data["choices"][0]["message"]["content"]
            parsed_json = _extract_json(raw_content)

            decision = RankingDecision(**parsed_json)

            result = {
                "winner_org_id": decision.winner_org_id,
                "confidence": decision.confidence,
                "reasoning": decision.reasoning,
                "risks": decision.risks,
                "fallback_org_id": decision.fallback_org_id,
                "ai_used": True,
                "gemini_used": True,  # backward compatibility for UI
                "provider": "openrouter",
                "cached": False,
                "reason_not_used": None,
                "ai_error": None,
                "gemini_error": None,
                "model": model_name,
            }

            # Cache the result
            _cache[cache_key] = (time.time(), result)
            return result

        except httpx.HTTPStatusError as exc:
            err_body = exc.response.text
            err_msg = f"OpenRouter HTTP {exc.response.status_code}: {err_body}"
            log.error("OpenRouter error: %s", err_msg)
            return _score_fallback(proposals, reason_not_used=err_msg, ai_error=err_msg)

        except Exception as exc:
            err_msg = str(exc)
            log.error("OpenRouter reasoning failed: %s", err_msg)
            return _score_fallback(proposals, reason_not_used=f"OpenRouter invocation error: {err_msg}", ai_error=err_msg)


# Alias for backward compatibility
rank_proposals_with_gemini = rank_proposals_with_openrouter
