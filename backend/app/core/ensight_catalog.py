"""E!nsight's map of the app: the endpoint catalog and the table cards.

The endpoint catalog is derived at runtime from the FastAPI app's own routes
(paired with the in-process caller in ``ensight_calling.py``), not hand
restated, so a renamed/added/removed route can't drift out of sync with what
the model is told exists. See docs/ENSIGHT.md ("Tier one — the read-only
endpoints").
"""
from __future__ import annotations

from pathlib import Path

import inspect
from dataclasses import dataclass

from fastapi import params as fastapi_params
from fastapi.routing import APIRoute
from pydantic_core import PydanticUndefined

# Routers exposing read-only, current_user-gated GET data endpoints E!nsight
# may call in-process. Auth, health, and the internal digest router (a
# different auth model, no user session) are deliberately excluded.
CATALOG_ROUTE_PREFIXES = ("/api/overview", "/api/cu", "/api/mentor-quality")


@dataclass(frozen=True)
class EndpointParam:
    name: str
    required: bool
    description: str


@dataclass(frozen=True)
class EndpointSpec:
    path: str
    params: tuple[EndpointParam, ...]
    summary: str


def _param_spec(name: str, query: fastapi_params.Query) -> EndpointParam:
    return EndpointParam(
        name=name,
        required=query.default is PydanticUndefined,
        description=(query.description or "").strip(),
    )


def iter_api_routes(routes) -> list[APIRoute]:
    """Recursively flatten an app's/router's ``.routes`` into plain ``APIRoute``s.

    FastAPI >=0.13x wraps each ``include_router()`` call in a lazily-matched
    ``_IncludedRouter`` (exposing the real sub-``APIRouter`` as
    ``.original_router``, not a flat route list) instead of eagerly flattening
    included routes onto ``app.routes`` the way older versions did. This walks
    both shapes so the catalog doesn't depend on which one is installed.
    """
    found: list[APIRoute] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append(route)
        elif hasattr(route, "original_router"):
            found.extend(iter_api_routes(route.original_router.routes))
        elif hasattr(route, "routes"):
            found.extend(iter_api_routes(route.routes))
    return found


def build_endpoint_catalog(app) -> list[EndpointSpec]:
    """Introspect the live FastAPI app for callable data endpoints.

    Only GET routes under ``CATALOG_ROUTE_PREFIXES`` whose signature is the
    shape every data router uses: some ``Query(...)`` params plus a single
    ``Depends(current_user)``. ``ensight_calling.call_endpoint`` is the paired
    in-process caller this catalog describes.
    """
    specs: list[EndpointSpec] = []
    for route in iter_api_routes(app.routes):
        if "GET" not in route.methods:
            continue
        if not route.path.startswith(CATALOG_ROUTE_PREFIXES):
            continue
        sig = inspect.signature(route.endpoint)
        params = tuple(
            _param_spec(name, p.default)
            for name, p in sig.parameters.items()
            if isinstance(p.default, fastapi_params.Query)
        )
        doc = (route.endpoint.__doc__ or "").strip()
        specs.append(EndpointSpec(path=route.path, params=params, summary=_first_paragraph(doc)))
    return sorted(specs, key=lambda s: s.path)


def _first_paragraph(doc: str) -> str:
    """The docstring's lead paragraph, collapsed to one line.

    A one-line docstring (most endpoints) is unaffected. A route whose
    payload isn't self-explanatory from its path (e.g. a wide gold-model dump
    with no metric names in the URL) can use a longer first paragraph to tell
    the planning step what's actually inside it — the single line a plain
    ``splitlines()[0]`` would give often isn't enough for the model to prefer
    the right endpoint over a wrong-but-plausible-sounding one.
    """
    if not doc:
        return ""
    paragraph = doc.split("\n\n", 1)[0]
    return " ".join(line.strip() for line in paragraph.splitlines())


def catalog_prompt_text(app) -> str:
    """Render the catalog as compact text for the planning prompt."""
    lines = []
    for spec in build_endpoint_catalog(app):
        params = ", ".join(
            f"{p.name}{'' if p.required else '?'}" + (f" ({p.description})" if p.description else "")
            for p in spec.params
        )
        tail = f" — {spec.summary}" if spec.summary else ""
        lines.append(f"- GET {spec.path}({params}){tail}")
    return "\n".join(lines)


# ── Table cards for the SQL-writing step ────────────────────────────────────
# Mined from the comments in core/tables.py, routers/mentor_quality.py and
# docs/METRICS.md during the Phase 0 survey (docs/ENSIGHT.md) — not from a
# live schema dump, since two of these sources have no fixed schema (see the
# "live schema volatility" note below). The gold model's field list below is
# the exception — it's the verified §7 catalogue from docs/METRICS.md, not
# guessed: a model asked to write SQL (or even just route a question) without
# real column names will invent plausible-sounding ones that don't exist.
TABLE_CARDS = """\
### gold_exp.exp_ai_dashboard_model
The dashboard's single source of truth for programme-delivery metrics. Wide
"one-big-table" (~158 columns). The discriminator is `level` ('cu' / 'school')
— CU rows and school rows are stacked in the same table and school rows roll
up into CU rows, so ANY aggregate without `level = 'cu'` OR `level = 'school'`
double-counts. Also one row per (cu, term) — summing across terms
multiply-counts a CU.

Key CU-level fields, by metric (full list: docs/METRICS.md §7):
- LEC delivery: schools_with_lecN (N=1-20), total_target_schools. Rate =
  (SUM(schools_with_lec1) + SUM(schools_with_lec2) + ... for the term's LECs,
  summed one column at a time) / (total_target_schools * #LECs in that
  term) * 100. T1 = LECs 1-5, T2 = LECs 6-14, T3 = LECs 15-20 (per
  frontend/src/lib/config.js's TERM_LECS — docs/METRICS.md §2.1 predates T3's
  rollout and still stops at T2, so trust the frontend config over that doc
  for T3). Any schools_with_lecN can be NULL on its own row — adding the
  columns together with a bare `+` before aggregating turns one NULL LEC
  into a NULL for the whole CU.
- Recruitment: total_scholars_recruited. Only ever populated on a CU's TERM1
  row — a term2/term3 row's copy of this field is stray/near-zero, not a
  real per-term figure. A question about term2 or term3 still reads this
  field from that CU's term1 row, never from the term being asked about.
- Retention: lec14_scholars (endpoint) / lec2_scholars (activation base) *
  100. These two columns are NOT on the same row for a later-term question:
  lec2_scholars is a T1 event and is only ever populated on the CU's TERM1
  row (same rule as recruitment above — read it from term1 regardless of
  which term was asked about); lec14_scholars is a T2 event and comes from
  the CU's TERM2 row. Filtering everything to one `WHERE term = 'termN'`
  and reading both columns off that single filtered row pairs a real
  numerator against a near-zero denominator (or vice versa) — a self-join
  or UNION between the CU's term1 rows and its target-term rows is required
  instead. If a CU has no term1 row, fall back to total_scholars_recruited
  as the denominator instead of lec2_scholars.
- Passbook quality: mN_quality_rated / mN_total_rated (N=1-4; M1/M2=T1,
  M3/M4=T2). Completion: schools_completed_m1..m4.
- Mentor coverage: total_active_mentors, total_observed_mentors,
  total_mentor_observations (NOT mentor_total_observations — that name was a
  legacy bug and doesn't exist in the live schema).
- Group Mentoring: schools_with_gm (overall), schools_with_gm1/gm2/gm3 (no
  gm4 — inactive), gm1/gm2/gm3_total_scholars, GM_total_scholars (aggregate).
- Community Day (T1): schools_with_community_day, cd_scholar_attendance,
  cd_non_scholar_attendance. Skills Day (T2): schools_with_skills_day,
  sd_total_scholars, sd_male_scholars/sd_female_scholars (sd_ prefix, not sl_).
- Club Milestones: schools_with_club_meeting_1..4, schools_with_bmp.
- Report timeliness: reports_on_schedule/reports_early (on time),
  reports_1_week_delay/reports_late/reports_unscheduled (late).
- avg_lec_session_duration has extreme per-CU outliers — use MEDIAN, not AVG,
  when aggregating across CUs (docs/METRICS.md §2.12).

### silver_exp.exp_2026_lec_observation_form
One row per LEC mentor observation. The raw `term` column is unreliable (bare
"1"/"2", inconsistent with the session date) — derive term from `date`
instead, against the fixed 2026 calendar: Term 1 = Feb 1-May 1, Term 2 =
May 25-Aug 21, Term 3 = Sep 14-Dec 4. Ratings live in qn* columns, not
readable names.

### bronze_exp.mentor_2026
The mentor roster. Has BOTH `cu` and `CU` columns — COALESCE(cu, CU) or a
count splits across the two. "Active mentor" = `first_login_at IS NOT NULL`
(no status column exists).

### silver_exp.exp_2026_skills_day_observation_form
### silver_exp.exp_2026_group_mentoring__observation__form
Neither has a `cu` column at all — CU is only recoverable by joining
`mentor_id` to the roster above, and that join doesn't reach 100% of rows.
Both are live survey exports whose schema gains and drops columns as
submissions land (a column with zero populated rows so far can vanish from
the table entirely between two checks minutes apart) — a query referencing a
column that doesn't currently exist is a hard error, not a NULL.

Across all tables: CU spellings differ between sources, and text dimensions
hold mixed casing. Group or join on UPPER(TRIM(col)), never the raw column.
"""

# ── Everything else in gold_exp/silver_exp/bronze_exp ───────────────────────
# A one-time snapshot (2026-09-24) of every other table's column names across
# the three allowed datasets (see ensight_guardrails.ALLOWED_DATASETS) —
# mechanically dumped from INFORMATION_SCHEMA.COLUMNS, not hand-reviewed the
# way TABLE_CARDS above is. Unlike the endpoint catalog, this is NOT refetched
# at runtime: re-querying INFORMATION_SCHEMA on every SQL-generation call
# would add a live BigQuery round-trip (and a test-mocking burden — see
# test_ensight_pipeline.py's docstring on why LLM/BigQuery calls are
# monkeypatched at import) to a step that used to be pure string formatting.
# A renamed/dropped column here surfaces as a dry-run failure, which already
# feeds the one-repair-attempt loop — the same safety net TABLE_CARDS itself
# relies on for the same staleness risk. Refresh this file (see the survey
# script noted in git history) if the schema drifts enough to matter.
_EXTRA_TABLES_PATH = Path(__file__).parent / "ensight_extra_tables.txt"
_EXTRA_TABLES_PREAMBLE = """\
### Everything else (unsurveyed — use with real caution)
Beyond the hand-reviewed tables above, gold_exp/silver_exp/bronze_exp also
contain the tables below (dataset.table: columns). None of these have been
individually vetted the way the tables above have: naming is wildly
inconsistent across them (e.g. `CU` vs `cu`, `School_name` vs `school_name`,
`mentor_ID` vs `mentor_id`), several are year-specific snapshots or
superseded duplicates of each other (e.g. multiple `mentor_activity_report_*`
tables), and a `raw_*` table whose only column is `form_data` holds an
unparsed JSON/form blob, not queryable columns — don't invent field names
inside it. Prefer a table above when it covers the question; reach for one of
these only when it doesn't, and sanity-check the result harder than usual
(these are exactly the tables the "implausible rate = likely a query bug"
rule two sections up was written for). Never select a raw name/contact/id/
geo-coordinate column from any of these as a raw output value — the same
COALESCE/NULL-safety and aggregation rules above apply here too, they just
haven't been individually verified per table.

Don't let a superficial name match substitute one concept for another: "eLab"
(bronze_exp.raw_exp_elab_mentor_learning_progress_YYYY — mentor_id,
mentor_name, lesson_name, date_started, date_finished, lesson_feedback) is a
mentor e-learning platform tracking lesson completion, and is a COMPLETELY
DIFFERENT thing from "LEC" (gold_exp's schools_with_lecN columns — in-person
mentoring session delivery) despite the similar-sounding name. A question
about "elab" means the eLab table above, never a LEC-delivery query — if you
answer an "elab" question with LEC delivery data, that is not a substitution,
it is a wrong answer about a different metric wearing the right question's
label. The same caution applies generally: two tables with similar-sounding
names or overlapping vocabulary in this list are not automatically the same
concept — check the actual column names before treating one as an answer to
a question about the other.

"""


def _load_extra_tables_text() -> str:
    try:
        return _EXTRA_TABLES_PREAMBLE + _EXTRA_TABLES_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


EXTRA_TABLES_TEXT = _load_extra_tables_text()
