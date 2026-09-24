"""ensight_llm: structured output via forced tool-calling, and the truncation
retry.

The OpenAI/OpenRouter SDK client is faked at ``_client()`` — these tests
never make a network call.
"""
import json
from dataclasses import dataclass

import pytest

from app.core import ensight_llm
from app.core.ensight_llm import EnsightLLMError, chat_json, chat_text

_SCHEMA = {"type": "object", "properties": {"route": {"type": "string"}}, "required": ["route"]}


@dataclass
class _Function:
    arguments: str


@dataclass
class _ToolCall:
    function: _Function


@dataclass
class _Message:
    content: str | None = None
    tool_calls: list | None = None


@dataclass
class _Choice:
    message: _Message
    finish_reason: str


@dataclass
class _Response:
    choices: list


class _FakeCompletions:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self._responses.pop(0)


class _FakeChat:
    def __init__(self, completions):
        self.completions = completions


class _FakeClient:
    def __init__(self, *responses):
        self.chat = _FakeChat(_FakeCompletions(responses))


def _tool_response(args: dict) -> _Response:
    message = _Message(content=None, tool_calls=[_ToolCall(function=_Function(json.dumps(args)))])
    return _Response(choices=[_Choice(message=message, finish_reason="tool_calls")])


def _raw_tool_response(raw_arguments: str) -> _Response:
    message = _Message(content=None, tool_calls=[_ToolCall(function=_Function(raw_arguments))])
    return _Response(choices=[_Choice(message=message, finish_reason="tool_calls")])


def _text_response(content: str) -> _Response:
    return _Response(choices=[_Choice(message=_Message(content=content), finish_reason="stop")])


def _truncated(tool_calls=None) -> _Response:
    return _Response(choices=[_Choice(message=_Message(content=None, tool_calls=tool_calls), finish_reason="length")])


def test_chat_json_returns_the_tool_calls_arguments(monkeypatch):
    fake = _FakeClient(_tool_response({"route": "sql"}))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)
    assert chat_json("sys", "usr", schema=_SCHEMA) == {"route": "sql"}


def test_chat_json_passes_schema_as_forced_tool(monkeypatch):
    fake = _FakeClient(_tool_response({"route": "dashboard"}))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)
    chat_json("sys", "usr", schema=_SCHEMA)
    call = fake.chat.completions.calls[0]
    assert call["tools"][0]["function"]["parameters"] == _SCHEMA
    assert call["tool_choice"] == {"type": "function", "function": {"name": ensight_llm._TOOL_NAME}}


def test_chat_json_raises_when_no_tool_call_returned(monkeypatch):
    fake = _FakeClient(_text_response("I'd rather just explain in prose."))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)
    with pytest.raises(EnsightLLMError):
        chat_json("sys", "usr", schema=_SCHEMA)


def test_chat_json_raises_on_invalid_arguments_json(monkeypatch):
    fake = _FakeClient(_raw_tool_response("not json at all"))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)
    with pytest.raises(EnsightLLMError):
        chat_json("sys", "usr", schema=_SCHEMA)


def test_chat_text_returns_stripped_prose(monkeypatch):
    fake = _FakeClient(_text_response("  Key finding: 42.  "))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)
    assert chat_text("sys", "usr") == "Key finding: 42."


def test_reasoning_is_explicitly_disabled_for_json_and_text(monkeypatch):
    # Regression: anthropic/claude-sonnet-5 emits extended-thinking tokens by
    # default via OpenRouter, which can consume an entire max_tokens budget
    # before writing any visible content (finish_reason "length", empty
    # content) — verified live against a real system prompt this size.
    # E!nsight's steps (routing, SQL, a formatted answer) don't need it.
    fake = _FakeClient(_tool_response({"route": "sql"}), _text_response("ok"))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)
    chat_json("sys", "usr", schema=_SCHEMA)
    chat_text("sys", "usr")
    for call in fake.chat.completions.calls:
        assert call["extra_body"] == {"reasoning": {"enabled": False}}


def test_truncation_retries_once_at_a_larger_budget(monkeypatch):
    fake = _FakeClient(_truncated(), _tool_response({"route": "sql"}))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)

    result = chat_json("sys", "usr", schema=_SCHEMA, max_tokens=900)

    assert result == {"route": "sql"}
    calls = fake.chat.completions.calls
    assert len(calls) == 2
    assert calls[0]["max_tokens"] == 900
    assert calls[1]["max_tokens"] == 1800  # doubled


def test_truncation_retry_is_capped(monkeypatch):
    fake = _FakeClient(_truncated(), _tool_response({"route": "sql"}))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)

    chat_json("sys", "usr", schema=_SCHEMA, max_tokens=3000)

    calls = fake.chat.completions.calls
    assert calls[1]["max_tokens"] == ensight_llm._MAX_RETRY_TOKENS  # 4000, not 6000


def test_truncation_on_both_attempts_raises(monkeypatch):
    fake = _FakeClient(_truncated(), _truncated())
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)

    with pytest.raises(EnsightLLMError):
        chat_json("sys", "usr", schema=_SCHEMA, max_tokens=900)

    assert len(fake.chat.completions.calls) == 2


def test_chat_text_truncation_retries_too(monkeypatch):
    fake = _FakeClient(_truncated(), _text_response("finished on retry"))
    monkeypatch.setattr(ensight_llm, "_client", lambda: fake)
    assert chat_text("sys", "usr", max_tokens=500) == "finished on retry"
