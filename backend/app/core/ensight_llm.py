"""OpenRouter client for E!nsight — structured output via forced tool-calling.

``chat_json`` uses a forced tool call rather than asking the model to
free-format a JSON blob in its text response. Verified live against
anthropic/claude-sonnet-5 (see docs/ENSIGHT.md's debugging note): asked to
embed a long, quote-and-backtick-heavy SQL string in a JSON text response, the
model mis-escaped it in roughly half of real attempts — a dropped closing
quote right before the final ``}``, a missing comma, or the whole object
wrapped in a stray markdown fence with no closing brace at all. Three
different malformations across two rounds of live testing, each needing its
own text-repair patch — a losing game. Tool-call arguments are produced
through the provider's own structured/constrained generation instead, which
does not have this failure mode (0 malformed across 6 live attempts once
switched over). ``chat_text`` stays free-text — used only for prose, where
there's no JSON to escape.
"""
from __future__ import annotations

import json
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class EnsightLLMError(Exception):
    """The model is unavailable, refuses, or returns unusable output."""


def _client():
    if not settings.OPENROUTER_API_KEY:
        raise EnsightLLMError("OPENROUTER_API_KEY is not set.")
    try:
        from openai import OpenAI
    except ImportError as exc:
        raise EnsightLLMError("openai package not installed.") from exc
    return OpenAI(api_key=settings.OPENROUTER_API_KEY, base_url="https://openrouter.ai/api/v1")


_MAX_RETRY_TOKENS = 4000  # ceiling for the one truncation-retry below
_TOOL_NAME = "submit_response"


def _base_kwargs(system: str, user: str, max_tokens: int, temperature: float) -> dict:
    return dict(
        model=settings.OPENROUTER_MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        temperature=temperature,
        max_tokens=max_tokens,
        # anthropic/claude-sonnet-5 emits extended-thinking tokens by default
        # via OpenRouter — verified live that a real system prompt this size
        # drove reasoning_tokens to the full max_tokens budget, leaving zero
        # room for the actual answer (finish_reason "length", empty content).
        # None of E!nsight's steps are deep-reasoning tasks (routing, SQL, a
        # formatted answer), so this is switched off rather than budgeted
        # around.
        extra_body={"reasoning": {"enabled": False}},
    )


def _retry_on_truncation(call, max_tokens: int):
    """Call ``call(tokens)`` once, retrying at a larger budget if the model
    ran out before finishing. A short answer that hits its budget is common
    enough (a ranking question invites a big table) that failing outright on
    the first truncation would be needlessly fragile; retrying at 2x (capped)
    costs one extra call only in that case."""
    choice = call(max_tokens)
    if choice.finish_reason == "length":
        retry_tokens = min(max_tokens * 2, _MAX_RETRY_TOKENS)
        if retry_tokens > max_tokens:
            logger.info("E!nsight model response truncated at %d tokens — retrying at %d.", max_tokens, retry_tokens)
            choice = call(retry_tokens)
    if choice.finish_reason == "length":
        raise EnsightLLMError("Model response was truncated before completing.")
    return choice


def chat_json(system: str, user: str, *, schema: dict, max_tokens: int = 1000, temperature: float = 0.2) -> dict:
    """One call, returning structured JSON matching ``schema`` (a JSON Schema
    ``object`` describing the expected shape) via a forced tool call."""
    client = _client()
    tool = {
        "type": "function",
        "function": {"name": _TOOL_NAME, "description": "Submit your structured response.", "parameters": schema},
    }

    def _call(tokens: int):
        response = client.chat.completions.create(
            **_base_kwargs(system, user, tokens, temperature),
            tools=[tool],
            tool_choice={"type": "function", "function": {"name": _TOOL_NAME}},
        )
        return response.choices[0]

    choice = _retry_on_truncation(_call, max_tokens)
    tool_calls = choice.message.tool_calls
    if not tool_calls:
        raise EnsightLLMError("Model did not return a structured response.")
    try:
        return json.loads(tool_calls[0].function.arguments)
    except json.JSONDecodeError as exc:
        raise EnsightLLMError(f"Model output was not valid JSON: {exc}") from exc


def chat_text(system: str, user: str, *, max_tokens: int = 900, temperature: float = 0.2) -> str:
    """One call, free-form prose back — used for the export report's expanded
    write-up, where the output is a paragraph, not a structured decision."""
    client = _client()

    def _call(tokens: int):
        response = client.chat.completions.create(**_base_kwargs(system, user, tokens, temperature))
        return response.choices[0]

    choice = _retry_on_truncation(_call, max_tokens)
    return (choice.message.content or "").strip()
