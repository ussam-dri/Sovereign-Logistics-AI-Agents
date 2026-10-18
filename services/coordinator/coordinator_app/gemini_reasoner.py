"""Backward-compatible redirect to OpenRouter reasoner."""
from coordinator_app.openrouter_reasoner import (
    rank_proposals_with_openrouter,
    rank_proposals_with_gemini,
)

__all__ = ["rank_proposals_with_openrouter", "rank_proposals_with_gemini"]
