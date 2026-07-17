"""Rules-based theme tagging for mentor/scholar observation comments.

No LLM, no external call: deterministic keyword/phrase matching against a
free-text comment field. Themes and cue words were derived from a sample of
the real comment corpus for each source — see docs/DECISION.md ADR-008 (LEC,
618-row corpus) and its follow-up (Skills Day, 227-row corpus).

Each theme match is additionally classified as a "strength" or "growth_area"
mention by looking for a cue word (needs/should/however/didn't/…) in the same
sentence as the keyword — this is what turns a raw score into something an
officer can act on ("12 mentors need coaching on time management" vs. just a
number).

Two theme sets exist because LEC (classroom pedagogy: visual aids,
lesson-plan adherence, ISSTUCK-style facilitation) and Skills Day (hands-on
product-making: tin/product quality, entrepreneurship, resource constraints)
describe genuinely different activities — reusing LEC's set against Skills
Day comments left ~80% of comments untagged and collapsed almost everything
else into a single generic "participation" bucket (verified against the live
corpus, not assumed).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

# (theme key, display label, keyword/phrase patterns — matched case-insensitively)
THEMES: list[tuple[str, str, list[str]]] = [
    ("time_management", "Time management", [r"time\s*management", r"\bmanage(?:d|s)?\s+time\b", r"\btiming\b", r"\bran out of time\b", r"time\s*check"]),
    ("energy_enthusiasm", "Energy & enthusiasm", [r"\benergy\b", r"\benergiz(?:e|er|ers|ed|ing)\b", r"\benthusias", r"\bexcitement\b"]),
    ("checking_understanding", "Checking for understanding", [r"check(?:s|ed|ing)?\s+for\s+understanding", r"check(?:s|ed|ing)?\s+.{0,15}understanding", r"\bcfu\b"]),
    ("gender_inclusivity", "Gender inclusivity", [r"gender\s*sensitiv", r"gender\s*inclusiv", r"both\s+(?:boys?\s+and\s+girls?|genders?)", r"boys?\s+and\s+girls?"]),
    ("visual_aids", "Visual aids", [r"visual\s*aids?", r"flip\s*chart", r"\bcharts?\b", r"\bposters?\b"]),
    ("real_life_examples", "Real-life / local examples", [r"real[\s-]?life", r"real[\s-]?world", r"local\s+example", r"relevant\s+example", r"case\s+stud", r"\bstories\b", r"\bstory\b"]),
    ("classroom_management", "Classroom management", [r"classroom\s*(?:management|control)", r"class\s*room\s*management", r"\bnoise\b", r"\bdiscipline\b"]),
    ("lesson_plan_adherence", "Lesson-plan adherence", [r"lesson\s*plan", r"follow(?:s|ed|ing)?\s+the\s+plan"]),
    ("facilitation_technique", "Facilitation technique (ISSTUCK/energizers/etc.)", [r"is\s*stuck", r"isstuck", r"pedvu", r"no\s*opt\s*out", r"turn\s+and\s+talk", r"\bfgds?\b", r"think\s*pair\s*(?:and\s*)?share", r"right\s+is\s+right"]),
    ("voice_pace_language", "Voice, pace & language", [r"voice\s*projection", r"\bpace\b", r"\bspeed\b", r"simple\s+(?:english|language)", r"complex\s+language"]),
    ("rapport_safe_space", "Rapport & safe space", [r"\brapport\b", r"safe\s+space", r"\btrust\b", r"relationship\s+with"]),
    ("participation", "Scholar participation", [r"participat", r"\bengage(?:d|s|ment)?\b", r"active(?:ly)?\s+involv"]),
    ("preparation_knowledge", "Preparation & content knowledge", [r"\bprepared\b", r"preparation", r"knowledgeable", r"master(?:ed|y)?\s+the\s+content"]),
    ("movement_proximity", "Movement & proximity", [r"intentional\s+movement", r"walked\s+around", r"\bmovement\b"]),
]

# Skills Day: hands-on product-making days (e.g. solid-perfume/tin-making),
# not classroom sessions — a different set of themes, derived from reading
# the real "Tin quality notes"/"Disruptions"/"Other observations"/
# "Participation comments" fields directly (see ADR-008 follow-up).
SKILLS_DAY_THEMES: list[tuple[str, str, list[str]]] = [
    ("product_quality", "Product / tin quality", [
        r"\bquality\b", r"\bdurable\b", r"break(?:able|s|ing)?", r"\btransparent\b", r"packag(?:e|ing)",
        r"\bscent\b", r"\bsmell\b", r"well[\s-]?made", r"fit\s+for", r"meets?\s+(?:the\s+)?quality",
    ]),
    ("entrepreneurial_intent", "Entrepreneurship & sales interest", [
        r"\bsold\b", r"\bsell(?:ing)?\b", r"\bprice[ds]?\b", r"\bpricing\b",
        r"start(?:ed|ing)?\s+(?:up\s+)?(?:this|a|their|an?)?\s*business", r"\bbusiness\b",
        r"continu(?:e|ed|ing)\s+(?:to\s+)?mak(?:e|ing)", r"\bmarket\b",
    ]),
    ("scale_up_demand", "Demand to scale up / expand", [
        r"whole\s+school", r"asked\s+for\s+more", r"more\s+of\s+(?:such|these|this)",
        r"more\s+such\s+skills", r"wish(?:ed)?\s+.{0,25}more",
    ]),
    ("resource_constraints", "Resource / material constraints", [
        r"not\s+enough", r"insufficient", r"lack(?:ed|ing)?\s+of", r"limited\s+material",
        r"using\s+firewood", r"materials?\s+(?:should|were)\s+.{0,15}(?:more|provided)",
    ]),
    ("safety_disruption", "Safety & disruptions", [
        r"disrupt", r"mov(?:ing|ed)\s+in\s+and\s+out", r"\bhazard", r"\bsafety\b", r"\bfirewood\b",
    ]),
    ("skill_mastery", "Skill mastery / independence", [
        r"on\s+their\s+own", r"master(?:ed|y)?", r"guided\s+enough", r"demonstrat(?:e|ed|ion)",
        r"understood?\s+the\s+process", r"do\s+it\s+(?:on\s+)?their\s+own",
    ]),
    ("participation", "Scholar participation", [r"participat", r"\bengage(?:d|s|ment)?\b", r"active(?:ly)?\s+involv"]),
    ("energy_enthusiasm", "Energy & enthusiasm", [r"\benergy\b", r"\benthusias", r"\bexcit(?:ed|ement)\b", r"\bmotivat"]),
    ("time_constraints", "Time constraints", [r"due\s+to\s+time", r"time\s+(?:did\s+not|didn'?t|could\s+not)\s+allow", r"only\s+\d+\s+managed"]),
    ("preparation_knowledge", "Preparation & content knowledge", [r"\bprepared\b", r"preparation", r"knowledgeable"]),
]

# Cue words that mark a sentence as flagging a growth area rather than praise.
_GROWTH_CUES = re.compile(
    r"\b(?:need(?:s|ed)?\s+to|should|however|but\s+|lack(?:s|ed|ing)?|didn'?t|does\s*n'?t|"
    r"struggl(?:e|ed|es|ing)|improve|better\s+if|not\s+all|no\s+opt|areas?\s+of\s+improvement|"
    r"has\s+to\s+work\s+on|could\s+(?:also\s+)?improve|not\s+enough|insufficient)\b",
    re.IGNORECASE,
)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?\n])\s+")


def _compile(themes: list[tuple[str, str, list[str]]]):
    return [(key, label, [re.compile(p, re.IGNORECASE) for p in patterns]) for key, label, patterns in themes]


_compiled_cache: dict[int, list] = {}


def _compiled(themes: list[tuple[str, str, list[str]]]):
    """Compile-and-cache a theme set, keyed by identity of the (module-level, never mutated) list."""
    key = id(themes)
    if key not in _compiled_cache:
        _compiled_cache[key] = _compile(themes)
    return _compiled_cache[key]


@dataclass
class ThemeMatch:
    key: str
    label: str
    sentiment: str  # "strength" | "growth_area"
    quote: str


def tag_comment(text: str, themes=THEMES) -> list[ThemeMatch]:
    """Return every theme mentioned in ``text``, each classified strength/growth_area.

    ``themes`` selects the rule set — default is LEC's (``THEMES``); pass
    ``SKILLS_DAY_THEMES`` for Skills Day comments.
    """
    if not text or not text.strip():
        return []
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
    matches: list[ThemeMatch] = []
    seen: set[tuple[str, str]] = set()
    for sentence in sentences:
        sentiment = "growth_area" if _GROWTH_CUES.search(sentence) else "strength"
        for key, label, patterns in _compiled(themes):
            if any(p.search(sentence) for p in patterns):
                dedup_key = (key, sentiment)
                # Keep first quote per (theme, sentiment) pair per comment; still
                # count every sentence-level hit via the caller's aggregation.
                matches.append(ThemeMatch(key=key, label=label, sentiment=sentiment, quote=sentence))
                seen.add(dedup_key)
    return matches


def summarize(rows: list[dict], comment_field: str = "comment", themes=THEMES) -> list[dict]:
    """Aggregate theme frequency across many tagged comments.

    ``rows`` is a list of dicts each containing ``comment_field``. Returns one
    entry per theme with strength/growth_area counts and a couple of sample
    quotes, sorted by total mentions (most-discussed theme first). ``themes``
    selects the rule set — default is LEC's; pass ``SKILLS_DAY_THEMES`` for
    Skills Day comments.
    """
    counts: dict[str, dict] = {
        key: {"theme": key, "label": label, "strength_count": 0, "growth_count": 0, "samples": []}
        for key, label, _ in themes
    }
    for row in rows:
        text = row.get(comment_field) or ""
        per_comment_themes: set[str] = set()
        for match in tag_comment(text, themes=themes):
            bucket = counts[match.key]
            if match.sentiment == "strength":
                bucket["strength_count"] += 1
            else:
                bucket["growth_count"] += 1
            if match.key not in per_comment_themes and len(bucket["samples"]) < 3:
                bucket["samples"].append({"quote": match.quote, "sentiment": match.sentiment})
            per_comment_themes.add(match.key)

    summary = list(counts.values())
    for entry in summary:
        entry["total"] = entry["strength_count"] + entry["growth_count"]
    summary.sort(key=lambda e: e["total"], reverse=True)
    return summary


def merge_summaries(*summaries: list[dict]) -> list[dict]:
    """Combine ``summarize()`` outputs computed under *different* theme sets
    (e.g. LEC's ``THEMES`` and Skills Day's ``SKILLS_DAY_THEMES``) into one
    list, summing counts for any theme key shared across sets (several are,
    deliberately — e.g. ``participation``) rather than listing it twice.
    """
    merged: dict[str, dict] = {}
    for summary in summaries:
        for entry in summary:
            key = entry["theme"]
            if key not in merged:
                merged[key] = {"theme": key, "label": entry["label"], "strength_count": 0, "growth_count": 0, "samples": []}
            bucket = merged[key]
            bucket["strength_count"] += entry["strength_count"]
            bucket["growth_count"] += entry["growth_count"]
            for sample in entry["samples"]:
                if len(bucket["samples"]) < 3:
                    bucket["samples"].append(sample)

    result = list(merged.values())
    for entry in result:
        entry["total"] = entry["strength_count"] + entry["growth_count"]
    result.sort(key=lambda e: e["total"], reverse=True)
    return result
