"""Rules-based theme tagging for mentor observation comments.

No LLM, no external call: deterministic keyword/phrase matching against the
free-text ``comments`` field on the mentor observation form. Themes and cue
words were derived from a sample of the real (618-row) comment corpus — see
docs/DECISION.md ADR-008.

Each theme match is additionally classified as a "strength" or "growth_area"
mention by looking for a cue word (needs/should/however/didn't/…) in the same
sentence as the keyword — this is what turns a raw score into something an
officer can act on ("12 mentors need coaching on time management" vs. just a
number).
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

# Cue words that mark a sentence as flagging a growth area rather than praise.
_GROWTH_CUES = re.compile(
    r"\b(?:need(?:s|ed)?\s+to|should|however|but\s+|lack(?:s|ed|ing)?|didn'?t|does\s*n'?t|"
    r"struggl(?:e|ed|es|ing)|improve|better\s+if|not\s+all|no\s+opt|areas?\s+of\s+improvement|"
    r"has\s+to\s+work\s+on|could\s+(?:also\s+)?improve)\b",
    re.IGNORECASE,
)

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?\n])\s+")

_COMPILED_THEMES = [(key, label, [re.compile(p, re.IGNORECASE) for p in patterns]) for key, label, patterns in THEMES]


@dataclass
class ThemeMatch:
    key: str
    label: str
    sentiment: str  # "strength" | "growth_area"
    quote: str


def tag_comment(text: str) -> list[ThemeMatch]:
    """Return every theme mentioned in ``text``, each classified strength/growth_area."""
    if not text or not text.strip():
        return []
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
    matches: list[ThemeMatch] = []
    seen: set[tuple[str, str]] = set()
    for sentence in sentences:
        sentiment = "growth_area" if _GROWTH_CUES.search(sentence) else "strength"
        for key, label, patterns in _COMPILED_THEMES:
            if any(p.search(sentence) for p in patterns):
                dedup_key = (key, sentiment)
                # Keep first quote per (theme, sentiment) pair per comment; still
                # count every sentence-level hit via the caller's aggregation.
                matches.append(ThemeMatch(key=key, label=label, sentiment=sentiment, quote=sentence))
                seen.add(dedup_key)
    return matches


def summarize(rows: list[dict], comment_field: str = "comment") -> list[dict]:
    """Aggregate theme frequency across many tagged comments.

    ``rows`` is a list of dicts each containing ``comment_field``. Returns one
    entry per theme with strength/growth_area counts and a couple of sample
    quotes, sorted by total mentions (most-discussed theme first).
    """
    counts: dict[str, dict] = {
        key: {"theme": key, "label": label, "strength_count": 0, "growth_count": 0, "samples": []}
        for key, label, _ in THEMES
    }
    for row in rows:
        text = row.get(comment_field) or ""
        per_comment_themes: set[str] = set()
        for match in tag_comment(text):
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
