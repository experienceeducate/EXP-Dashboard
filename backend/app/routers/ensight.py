"""E!nsight: dashboard-first Q&A over EXP programme data.

See docs/ENSIGHT.md for the full design. Gated tighter than the rest of the
app — only emails explicitly listed in ``ACCESS_CONFIG["national"]`` (excludes
``national_only`` and all regional/CU staff) — because this is the one
feature that turns a typed sentence into a warehouse query and spends real
money per question.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.auth import current_user
from app.core.access import UserAccess
from app.core.config import settings
from app.core.ensight_llm import EnsightLLMError
from app.core.ensight_pipeline import RateLimitError, ask, check_rate_limit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ensight", tags=["ensight"])


def _is_ensight_user(user: UserAccess) -> bool:
    return user.has_national and not user.national_only


@router.get("/availability")
def availability(user: UserAccess = Depends(current_user)):
    """Open to any signed-in user so the SPA can decide whether to render the
    tab, instead of showing everyone a tab that 403s."""
    return {"status": "ok", "available": bool(settings.OPENROUTER_API_KEY) and _is_ensight_user(user)}


class AskRequest(BaseModel):
    question: str
    history: list[dict] = []
    term: str | None = None
    cu: str | None = None
    force_refresh: bool = False


@router.post("/ask")
def ask_question(body: AskRequest, user: UserAccess = Depends(current_user)):
    if not _is_ensight_user(user):
        raise HTTPException(status_code=403, detail="E!nsight is not available for this account.")
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="E!nsight is not configured (OPENROUTER_API_KEY unset).")

    from app.main import app as fastapi_app  # deferred: main imports this router at module load

    filters = {"term": body.term, "cu": body.cu}
    try:
        result = ask(fastapi_app, user, body.question, body.history, filters, body.force_refresh)
    except RateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except EnsightLLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "status": "ok",
        "answer": result.answer,
        "route": result.route,
        "cached": result.cached,
        "cached_minutes_ago": result.cached_minutes_ago,
        "sources": result.sources,
        "rows": result.rows,
        "row_count": result.row_count,
        "notes": result.notes,
    }


class ExportSource(BaseModel):
    kind: str = Field(pattern="^(endpoint|sql)$")
    path: str | None = Field(default=None, max_length=200)
    params: dict | None = None
    sql: str | None = Field(default=None, max_length=20000)


class ExportItem(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    answer: str = Field(max_length=20000)
    sources: list[ExportSource] = Field(default_factory=list, max_length=4)
    notes: list[str] = Field(default_factory=list, max_length=8)


class ExportRequest(BaseModel):
    format: str = Field(pattern="^(pptx|docx)$")
    items: list[ExportItem] = Field(min_length=1, max_length=10)


@router.post("/export")
def export_answers(body: ExportRequest, user: UserAccess = Depends(current_user)):
    """Build a PowerPoint deck or Word report from selected answers.

    The browser sends the questions and which sources each answer used — the
    numbers are re-derived server-side (see core/ensight_export), so an
    exported document can't carry figures that didn't pass the same
    guardrails as the on-screen answer. Slower than a question (it re-reads
    evidence and re-narrates each answer) and spends model calls, so it
    shares the per-user rate limit.
    """
    if not _is_ensight_user(user):
        raise HTTPException(status_code=403, detail="E!nsight is not available for this account.")
    if not settings.OPENROUTER_API_KEY:
        raise HTTPException(status_code=503, detail="E!nsight is not configured (OPENROUTER_API_KEY unset).")

    try:
        check_rate_limit(user.email)
    except RateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc

    from app.core import ensight_export
    from app.main import app as fastapi_app

    try:
        data, filename, media_type = ensight_export.build(
            [item.model_dump() for item in body.items], body.format, user, fastapi_app
        )
    except Exception as exc:  # noqa: BLE001 — surfaced as a readable 502
        logger.exception("E!nsight export failed")
        raise HTTPException(status_code=502, detail=f"Could not build the report: {exc}") from exc

    return Response(
        content=data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Programme figures, however aggregated — keep it out of any shared cache.
            "Cache-Control": "no-store",
        },
    )
