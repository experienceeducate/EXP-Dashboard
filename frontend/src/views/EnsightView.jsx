// E!nsight — "Your Educate! Insights Friend". Dashboard-first Q&A over the EXP
// programme data (see docs/ENSIGHT.md). Only rendered once the SPA has
// confirmed availability with the backend (App.jsx), but still handles a 403
// gracefully in case that check goes stale mid-session.
//
// The whole point of this panel is that an answer is checkable: every reply
// shows where its numbers came from — the dashboard endpoints it read, or the
// SQL it ran and the rows that came back when it had to fall back to the
// warehouse. A number with no visible source is exactly the thing the team
// shouldn't have to take on trust, so this view never presents one bare.
import { useRef, useState } from 'react';
import * as api from '../lib/api.js';
import { C } from '../lib/config.js';
import Markdown from '../lib/markdown.jsx';

const ROUTE_LABELS = {
  dashboard: 'From the dashboard',
  sql: 'BigQuery',
  refuse: "Couldn't answer",
};

const EXAMPLE_QUESTIONS = [
  'Which CU had the lowest LEC delivery rate last term?',
  'How many mentors have never logged in?',
  'What is our national retention rate this term?',
];

// The evidence rows behind a warehouse answer, so a figure can be checked
// against what actually came back rather than taken on trust.
function ResultTable({ rows }) {
  if (!rows || rows.length === 0) return null;
  const columns = Object.keys(rows[0]);
  const shown = rows.slice(0, 25);
  return (
    <div style={{ marginTop: 10 }}>
      <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  style={{
                    textAlign: 'left', padding: '.4rem .6rem', borderBottom: '2px solid #e5e9ed',
                    fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: '#888',
                    position: 'sticky', top: 0, background: '#fff',
                  }}
                >
                  {c.replace(/_/g, ' ')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c} style={{ padding: '.4rem .6rem', borderBottom: '1px solid #f0f0f0', color: '#333' }}>
                    {row[c] == null ? '—' : typeof row[c] === 'number' ? Number(row[c]).toLocaleString() : String(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 25 ? (
        <div style={{ fontSize: '.72rem', color: '#999', marginTop: 6 }}>
          Showing 25 of {rows.length.toLocaleString()} rows returned.
        </div>
      ) : null}
    </div>
  );
}

// The provenance strip under an answer: route, endpoints called (or the SQL
// that ran, revealed on click), the rows behind it, and any escalation notes.
function AnswerSources({ result }) {
  const [showSql, setShowSql] = useState(false);
  const sqlSource = (result.sources || []).find((s) => s.kind === 'sql');
  const endpoints = (result.sources || []).filter((s) => s.kind === 'endpoint');

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #eee' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: '#999' }}>
          {ROUTE_LABELS[result.route] || result.route}
        </span>
        {endpoints.map((s, i) => (
          <code
            key={i}
            style={{ fontSize: '.72rem', background: '#f5f6f7', border: '1px solid #e5e9ed', borderRadius: 4, padding: '1px 6px', color: '#555' }}
          >
            {s.path}
          </code>
        ))}
        {sqlSource ? (
          <span
            onClick={() => setShowSql((v) => !v)}
            style={{ fontSize: '.75rem', fontWeight: 700, color: C.blue, cursor: 'pointer' }}
          >
            {showSql ? 'Hide the SQL ⌃' : 'Show the SQL ⌄'}
          </span>
        ) : null}
      </div>

      {sqlSource && showSql ? (
        <pre
          style={{
            marginTop: 8, background: C.navy, color: '#D8E4EC', padding: 12, borderRadius: 6,
            fontSize: '.72rem', lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre-wrap',
          }}
        >
          {sqlSource.sql}
        </pre>
      ) : null}

      <ResultTable rows={result.rows} />

      {(result.notes || []).length > 0 ? (
        <ul style={{ margin: '10px 0 0 16px', padding: 0 }}>
          {result.notes.map((note, i) => (
            <li key={i} style={{ fontSize: '.72rem', color: '#999', lineHeight: 1.5 }}>
              {note}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Pick which answers go into a PowerPoint deck or a Word report.
//
// Downloaded via fetch + blob, not a plain <a href>: /api/ensight/export needs
// the JWT and X-Exp-Client headers, and an anchor cannot attach either — it
// would save the 403's JSON body under a .pptx name, producing a file
// PowerPoint refuses to open.
function EnsightExportDialog({ open, onClose, thread }) {
  const [selected, setSelected] = useState(() => new Set());
  const [format, setFormat] = useState('pptx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Errors and answers only — a failed turn has nothing to report.
  const exportable = thread.filter((t) => t.result?.answer);

  if (!open) return null;

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const download = async () => {
    const items = exportable
      .filter((t) => selected.has(t.id))
      .map((t) => ({
        question: t.question,
        answer: t.result.answer,
        // Sources travel, not figures: the server re-reads the evidence so an
        // exported number has passed the same guardrails as the on-screen one.
        sources: (t.result.sources || []).map((s) =>
          s.kind === 'sql' ? { kind: 'sql', sql: s.sql } : { kind: 'endpoint', path: s.path, params: s.params || {} },
        ),
        notes: (t.result.notes || []).slice(0, 8),
      }));
    if (!items.length) return;

    setBusy(true);
    setError(null);
    let objectUrl = null;
    try {
      const { blob, filename } = await api.exportEnsight(format, items);
      objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    }
  };

  return (
    <>
      <div className="drill-backdrop" onClick={busy ? undefined : onClose} />
      <div
        role="dialog"
        aria-label="Export E!nsight answers"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: '#fff', borderRadius: 12, padding: '1.5rem', width: 480, maxWidth: '90vw',
          maxHeight: '85vh', overflow: 'auto', zIndex: 1000, boxShadow: '0 10px 40px rgba(0,0,0,.25)',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: '.3rem', color: C.navy }}>Export answers</h3>
        <p style={{ fontSize: '.82rem', color: '#666', marginTop: 0, lineHeight: 1.5 }}>
          Figures are re-read from the dashboard or re-run against BigQuery as the file is built, so the document
          matches live data rather than what's on screen. A Word report carries the full written insight; a deck
          keeps slides short and puts the detail in the speaker notes.
        </p>

        <div style={{ display: 'flex', gap: '.5rem', margin: '1rem 0' }}>
          {[['pptx', 'PowerPoint'], ['docx', 'Word']].map(([value, label]) => (
            <div
              key={value}
              onClick={() => setFormat(value)}
              style={{
                padding: '.45rem 1rem', borderRadius: 20, fontSize: '.8rem', fontWeight: 700, cursor: 'pointer',
                background: format === value ? C.navy : '#fff',
                color: format === value ? '#fff' : '#333',
                border: `1px solid ${format === value ? C.navy : '#ccc'}`,
              }}
            >
              {label}
            </div>
          ))}
        </div>

        {exportable.length === 0 ? (
          <p style={{ fontSize: '.85rem', color: '#999' }}>Ask something first — there are no answers to export yet.</p>
        ) : (
          <div style={{ marginBottom: '1rem' }}>
            {exportable.map((t) => (
              <label
                key={t.id}
                style={{ display: 'flex', gap: '.6rem', alignItems: 'flex-start', padding: '.5rem 0', borderBottom: '1px solid #eee', cursor: 'pointer', fontSize: '.85rem' }}
              >
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} style={{ marginTop: 3 }} />
                <span style={{ color: '#333' }}>{t.question}</span>
              </label>
            ))}
            <div style={{ fontSize: '.72rem', color: '#999', marginTop: '.5rem' }}>
              {selected.size} selected{selected.size > 10 ? ' — only the first 10 are included' : ''}
            </div>
          </div>
        )}

        {error ? (
          <div style={{ padding: '.6rem .7rem', background: '#fdecea', border: '1px solid #e6b0aa', borderRadius: 6, color: '#b3261e', fontSize: '.8rem', marginBottom: '.8rem' }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={busy ? undefined : onClose}
            disabled={busy}
            style={{ padding: '.5rem 1rem', borderRadius: 6, fontSize: '.85rem', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', color: '#555', border: '1px solid #ccc', background: '#fff' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={download}
            disabled={busy || !selected.size}
            style={{
              padding: '.5rem 1.1rem', borderRadius: 6, fontSize: '.85rem', fontWeight: 700, border: 'none',
              background: busy || !selected.size ? '#ccc' : C.navy,
              color: busy || !selected.size ? '#888' : '#fff',
              cursor: busy || !selected.size ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Building…' : 'Download'}
          </button>
        </div>
        {busy ? (
          <div style={{ fontSize: '.72rem', color: '#999', marginTop: '.6rem', textAlign: 'right' }}>
            Re-reading the evidence and writing it up — this takes a moment per answer.
          </div>
        ) : null}
      </div>
    </>
  );
}

export default function EnsightView({ term }) {
  const [thread, setThread] = useState([]); // [{id, question, result} | {id, question, error}]
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  // Which turns are expanded, as explicit per-id overrides rather than a set
  // of open ids — "newest is open by default" stays a derived rule instead of
  // needing an effect to re-open the newest turn each time one arrives.
  const [openOverrides, setOpenOverrides] = useState({});
  const newestId = thread.length ? thread[thread.length - 1].id : null;
  const isOpen = (id) => openOverrides[id] ?? id === newestId;
  const toggleOpen = (id) => setOpenOverrides((prev) => ({ ...prev, [id]: !(prev[id] ?? id === newestId) }));
  const [exportOpen, setExportOpen] = useState(false);

  const activeFilters = term ? [`term: ${term}`] : [];

  // `fresh` skips the server's answer cache — used by "Ask again" on a reused
  // answer, so a stale figure is never something you're stuck with.
  const submit = async (question, { fresh = false } = {}) => {
    const text = (question ?? draft).trim();
    if (!text || busy) return;
    setBusy(true);
    setDraft('');
    // Only the last two exchanges travel as history — enough for "and for
    // last term?" to resolve, without an ever-growing prompt.
    const history = thread
      .slice(-2)
      .flatMap((t) => [
        { role: 'user', content: t.question },
        { role: 'assistant', content: t.result?.answer || '' },
      ])
      .filter((h) => h.content);

    const id = nextId.current++;
    try {
      const res = await api.askEnsight(text, history, { term }, fresh);
      setThread((prev) => [...prev, { id, question: text, result: res }]);
    } catch (e) {
      setThread((prev) => [...prev, { id, question: text, error: e.message || 'Could not reach the dashboard API.' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <EnsightExportDialog open={exportOpen} onClose={() => setExportOpen(false)} thread={thread} />
      <div style={{ background: '#fff', border: '1px solid #e5e9ed', borderRadius: 10, padding: '1.1rem 1.3rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0, color: C.navy }}>E!nsight</h2>
        <p style={{ margin: '.3rem 0 0', color: '#666', fontSize: '.85rem', lineHeight: 1.55 }}>
          Your Educate! Insights Friend. Ask a question in plain English about the EXP programme data. Answers built
          from a freshly generated BigQuery query are labelled "BigQuery" — a flag that they are not from dashboard
          numbers, so it's worth double-checking them.
        </p>

        {activeFilters.length > 0 ? (
          <div style={{ fontSize: '.78rem', color: '#888', margin: '.6rem 0 0' }}>
            Your term filter is applied unless the question says otherwise — {activeFilters.join(' · ')}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end', marginTop: '.7rem' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit(draft);
              }
            }}
            placeholder="e.g. Which CU had the lowest LEC delivery rate last term?"
            rows={2}
            disabled={busy}
            style={{
              flex: 1, resize: 'vertical', padding: '.6rem .8rem', fontSize: '.9rem', fontFamily: 'inherit',
              color: '#222', background: '#fff', border: '1px solid #ccc', borderRadius: 8, lineHeight: 1.5,
            }}
          />
          <button type="button" className="btn primary" disabled={busy || !draft.trim()} onClick={() => submit(draft)}>
            {busy ? 'Thinking…' : 'Ask'}
          </button>
        </div>

        {thread.some((t) => t.result?.answer) ? (
          <div style={{ marginTop: '.8rem', display: 'flex', justifyContent: 'flex-end' }}>
            <span onClick={() => setExportOpen(true)} style={{ fontSize: '.8rem', fontWeight: 700, color: C.blue, cursor: 'pointer' }}>
              Export to PowerPoint or Word ⌄
            </span>
          </div>
        ) : null}

        {thread.length === 0 ? (
          <div style={{ marginTop: '.9rem' }}>
            <div style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em', color: '#999', marginBottom: '.4rem' }}>
              Try one of these
            </div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => submit(q)}
                  style={{ border: '1px solid #ccc', background: '#fff', color: '#333', padding: '.4rem .8rem', borderRadius: 16, fontSize: '.8rem', cursor: 'pointer' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {busy ? (
        <div style={{ padding: '1rem', textAlign: 'center', color: '#999', fontSize: '.85rem' }}>Checking the dashboard…</div>
      ) : null}

      {/* Newest answer first, directly under the ask box — a long session
          shouldn't push what you just asked off the bottom of the page. Only
          the newest turn is expanded; earlier ones collapse to their question
          and open on click. `thread` itself stays chronological because the
          follow-up history sent with each question depends on that order;
          only the rendering is reversed. Keyed by the turn's own id, not
          array index, so reversing can't make React reuse one answer's DOM
          for another's. */}
      {thread
        .slice()
        .reverse()
        .map((turn) => {
          const open = isOpen(turn.id);
          const routeLabel = turn.error ? 'error' : ROUTE_LABELS[turn.result?.route] || turn.result?.route;
          return (
            <div key={turn.id} style={{ marginBottom: open ? '1rem' : '.4rem' }}>
              <div
                onClick={() => toggleOpen(turn.id)}
                style={{
                  fontSize: '.9rem', fontWeight: 700, color: C.navy, marginBottom: open ? '.5rem' : 0,
                  display: 'flex', gap: '.5rem', alignItems: 'baseline', cursor: 'pointer',
                  padding: open ? 0 : '.6rem .8rem',
                  background: open ? 'transparent' : '#fff',
                  border: open ? 'none' : '1px solid #e5e9ed',
                  borderRadius: open ? 0 : 8,
                }}
              >
                <span style={{ color: C.yellow, display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none' }}>›</span>
                <span style={{ flex: 1, fontWeight: open ? 700 : 600 }}>{turn.question}</span>
                {!open ? (
                  <span style={{ fontSize: '.68rem', fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                    {routeLabel}
                  </span>
                ) : null}
              </div>

              {open ? (
                turn.error ? (
                  <div style={{ padding: '.9rem', background: '#fdecea', border: '1px solid #e6b0aa', borderRadius: 8, color: '#b3261e', fontSize: '.85rem' }}>
                    {turn.error}
                  </div>
                ) : (
                  <div style={{ background: '#fff', border: '1px solid #e5e9ed', borderRadius: 8, borderLeft: `3px solid ${C.blue}`, padding: '.9rem 1.1rem' }}>
                    {turn.result.cached ? (
                      <div style={{ fontSize: '.75rem', color: '#888', marginBottom: '.5rem', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
                        <span>
                          Reused an earlier answer
                          {turn.result.cached_minutes_ago != null ? ` from ${turn.result.cached_minutes_ago} min ago` : ''} — no
                          tokens spent.
                        </span>
                        <span onClick={() => submit(turn.question, { fresh: true })} style={{ color: C.blue, fontWeight: 700, cursor: 'pointer' }}>
                          Ask again
                        </span>
                      </div>
                    ) : null}
                    <Markdown text={turn.result.answer} />
                    <AnswerSources result={turn.result} />
                  </div>
                )
              ) : null}
            </div>
          );
        })}
    </div>
  );
}
