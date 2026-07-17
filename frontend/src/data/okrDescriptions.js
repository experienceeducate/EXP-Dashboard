// OKR names/descriptions, transcribed verbatim from the approved Investment
// Memo ("APPROVED_ E! EXP Investment Memo_Jan 2026 (2).pdf", repo root,
// gitignored). Keyed by the exact `okrGroup` string used in
// learningMeasurementMap.js so the Learning & Measurement Map tab can show
// the real OKR text under each group heading, not just the sheet's shorthand.
//
// The Investment Memo has two OKR trees: "Product OKRs" (Objective 1 & 2) and
// "Program Implementation and Field Ops OKRs" (Objective 1 & 2). The Learning
// and Measurement Map spreadsheet's own anchor labels don't map 1:1 onto that
// structure in a couple of places — noted per-entry below rather than papered
// over.

export const OKR_DESCRIPTIONS = {
  'Product OKRs - Objective 1: KR1': {
    objective: 'Product OKRs — Objective 1: Design a scalable EXP Learning Experience that deepens grit and soft-skills outcomes while sustaining strong earn-save-act behaviors for 36,000 scholars.',
    keyResult: 'KR1: Achieve >70% of scholars scoring at least 2/3 on milestone actions and >80% reporting receiving Passbook feedback, by embedding behavioral milestones into the scholar journey and aligning LECs and the Passbook to reinforce action, feedback, and habit formation.',
  },
  'Product OKRs - Objective 1: KR2': {
    objective: 'Product OKRs — Objective 1: Design a scalable EXP Learning Experience that deepens grit and soft-skills outcomes while sustaining strong earn-save-act behaviors for 36,000 scholars.',
    keyResult: 'KR2: Strengthen product–user fit by continuously integrating youth insights and usage data into LX improvements, demonstrated by measurable increases in perceived value (feature-level NPS > 50) and usability (>80% of scholars reporting the LX helps them take action).',
  },
  'Product OKRs - Objective 2: KR1': {
    objective: 'Product OKRs — Objective 2: Validate pathways and approaches for agency development and integrate insights into the wider product portfolio, positioning EXP as an R&D engine.',
    keyResult: 'KR1: Complete the Growth Mindset/WISE Interventions experiment, synthesize findings demonstrating changes in agency and mindset (using at least two validated indicators), and deliver an integration pathway ready for incorporation into the product model.',
  },
  'Product OKRs - Objective 2: KR2': {
    objective: 'Product OKRs — Objective 2: Validate pathways and approaches for agency development and integrate insights into the wider product portfolio, positioning EXP as an R&D engine.',
    keyResult: 'KR2: Test at least one micro-intervention and conduct qualitative research to surface the core drivers of individual agency development, delivering a validated insights package and an integration plan for various E! products.',
  },
  'Product OKRs - Objective 2: KR3': {
    objective: 'Product OKRs — Objective 2: Validate pathways and approaches for agency development and integrate insights into the wider product portfolio, positioning EXP as an R&D engine.',
    keyResult: 'KR3: Update an org-wide Theory of Change for agency development with at least 3 validated assumptions tested in EXP.',
  },
  'Delivery OKRs - Objective 1: KR1': {
    objective: 'Program Implementation & Field Ops OKRs — Objective 1: Reignite mission-driven leadership among frontline teams and strengthen their connection to youth impact, shared purpose, and professional growth, by implementing a validated Brand Building Fellowship Model for mentors and Learning & Development modules for frontline staff.',
    keyResult: 'KR1: Achieve a 10% increment in the baseline-to-endline survey in the number of frontline teams that demonstrate key brand hallmarks like Passion for Youth, an insurgent mindset, and the ability to connect their work to the WHY.',
    note: 'The source spreadsheet labels this "Delivery OKRs" — the approved Investment Memo has no separate "Delivery OKRs" tree; this is Program Implementation & Field Ops Objective 1.',
  },
  'Implementation OKRs - Objective 1: KR1': {
    objective: 'Program Implementation & Field Ops OKRs — Objective 2: Implement a simplified frontline structure that eliminates the PQO/PO matrix, clarifies decision rights, strengthens accountability, and rebuilds one-team cohesion.',
    keyResult: 'KR2: Following the roll-out of the new structure with updated JDs, performance standards, and ways of work, run a survey to measure improvement in team culture and performance against four core indicators: improved team cohesion, improved role clarity, improved accountability, and reduced microcultures.',
    note: 'The source spreadsheet labels this "Implementation OKRs — Objective 1: KR1" — by content this maps to Objective 2: KR2 in the approved Investment Memo, not Objective 1. Objective 2 also has a KR1 ("Structure implemented: by end of Q2, transition all teams to the simplified frontline structure, PQO/PO matrix removed, with updated JDs/standards/reporting lines") — verified against the memo, no metric in this map currently tracks it.',
  },
  'Implementation OKRs - Objective 1: KR2': {
    objective: 'Program Implementation & Field Ops OKRs — Objective 2: Implement a simplified frontline structure that eliminates the PQO/PO matrix, clarifies decision rights, strengthens accountability, and rebuilds one-team cohesion.',
    keyResult: 'KR2: Following the roll-out of the new structure with updated JDs, performance standards, and ways of work, run a survey to measure improvement in team culture and performance against four core indicators: improved team cohesion, improved role clarity, improved accountability, and reduced microcultures.',
    note: 'Operationalizes the same KR2 survey as "Improvement in Team culture and performance index" above — a different cut (culture rating distribution) of the same source data. Objective 2 also has a KR1 ("Structure implemented" — the matrix-removal transition itself) not currently tracked by any metric in this map.',
  },
  'Implementation OKRs': {
    objective: 'Program Implementation & Field Ops OKRs — spans Objective 1 (frontline mission/culture) and Objective 2 (simplified structure, role clarity).',
    keyResult: 'Not tied to one specific KR in the approved memo — tracked here as a related frontline-quality signal (Patron-rated mentor quality).',
  },
};
