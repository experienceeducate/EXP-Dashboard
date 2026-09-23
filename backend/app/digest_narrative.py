"""Narrative generation for the weekly digest, via OpenRouter.

Deliberately a thin wrapper: all number-crunching happens in digest_metrics.py
and is handed in as already-computed, trusted data — the model only turns it
into readable prose and prioritised action steps, never invents figures.
No-ops (returns None) if OPENROUTER_API_KEY isn't set, so the digest still
sends a perfectly usable (just less narrative) email without it.

Uses the `openai` SDK pointed at OpenRouter's OpenAI-compatible endpoint
(https://openrouter.ai/docs) rather than the Anthropic SDK directly, so the
model string is OpenRouter's `anthropic/claude-sonnet-5`, not Anthropic's own
`claude-sonnet-5`.
"""
from __future__ import annotations

import json
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You write a concise weekly progress digest for an education \
programme's leadership team, based on structured metrics data they provide. \
Rules:
- Never invent or adjust any number — use only the figures given.
- Be direct about what's struggling, not just what's going well.
- End with 3-5 prioritised, concrete action steps a programme team could act on \
  this week.
- Write in plain prose (no markdown headers), 200-350 words total.
- Address the reader as "the team", not "you".
"""


def generate_narrative(digest_data: dict) -> str | None:
    if not settings.OPENROUTER_API_KEY:
        logger.info("OPENROUTER_API_KEY not set — skipping narrative generation.")
        return None

    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("openai package not installed — skipping narrative generation.")
        return None

    try:
        client = OpenAI(
            api_key=settings.OPENROUTER_API_KEY,
            base_url="https://openrouter.ai/api/v1",
        )
        response = client.chat.completions.create(
            model=settings.OPENROUTER_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(digest_data, default=str)},
            ],
            temperature=0.4,
            max_tokens=600,
        )
        return response.choices[0].message.content
    except Exception:  # noqa: BLE001 — narrative is a nice-to-have, never fail the digest over it
        logger.exception("OpenRouter narrative generation failed — sending digest without it.")
        return None
