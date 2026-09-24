// ─────────────────────────────────────────────────────────────────────────────
// Minimal Markdown renderer: bold, inline code, unordered/ordered lists, and
// pipe tables — just enough for E!nsight's labelled answers. Not a general
// Markdown engine; no links, images, headers, or nested blocks.
// ─────────────────────────────────────────────────────────────────────────────

const INLINE_TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/;

// The model escapes underscores in column names (`acquired\_at\_site`) because
// that's correct markdown — an unescaped pair would italicise. This renderer
// doesn't do italics, so without unescaping, every such name would render
// with literal backslashes. Applied last, so an escaped asterisk can't be
// mistaken for bold on the way through.
function unescapeMd(text) {
  return String(text).replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, '$1');
}

function renderInline(text, keyBase) {
  const parts = [];
  let rest = text;
  let i = 0;
  while (rest.length > 0) {
    const m = INLINE_TOKEN.exec(rest);
    if (!m) {
      parts.push(unescapeMd(rest));
      break;
    }
    if (m.index > 0) parts.push(unescapeMd(rest.slice(0, m.index)));
    const token = m[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={`${keyBase}-${i++}`}>{unescapeMd(token.slice(2, -2))}</strong>);
    } else {
      parts.push(
        <code
          key={`${keyBase}-${i++}`}
          style={{ background: '#f0f0f0', borderRadius: 4, padding: '0 4px', fontSize: '.9em' }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    }
    rest = rest.slice(m.index + token.length);
  }
  return parts;
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isTableRule = (line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function renderTable(lines, key) {
  const header = tableCells(lines[0]);
  const bodyLines = lines.slice(2);
  return (
    <table key={key} style={{ borderCollapse: 'collapse', width: '100%', margin: '.5rem 0', fontSize: '.9rem' }}>
      <thead>
        <tr>
          {header.map((h, i) => (
            <th key={i} style={{ textAlign: 'left', borderBottom: '2px solid #ddd', padding: '.3rem .5rem' }}>
              {renderInline(h, `th-${i}`)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bodyLines.map((line, ri) => (
          <tr key={ri}>
            {tableCells(line).map((c, ci) => (
              <td key={ci} style={{ borderBottom: '1px solid #eee', padding: '.3rem .5rem' }}>
                {renderInline(c, `td-${ri}-${ci}`)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Markdown({ text }) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let i = 0;
  let listBuffer = [];
  let listOrdered = false;

  const flushList = () => {
    if (listBuffer.length === 0) return;
    const Tag = listOrdered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${blocks.length}`} style={{ margin: '.4rem 0', paddingLeft: '1.4rem' }}>
        {listBuffer.map((item, idx) => (
          <li key={idx}>{renderInline(item, `li-${blocks.length}-${idx}`)}</li>
        ))}
      </Tag>,
    );
    listBuffer = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (isTableRow(line) && isTableRule(lines[i + 1] || '')) {
      flushList();
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j])) j++;
      blocks.push(renderTable(lines.slice(i, j), `table-${blocks.length}`));
      i = j;
      continue;
    }

    const bulletMatch = /^\s*[-*]\s+(.*)$/.exec(line);
    const orderedMatch = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (bulletMatch || orderedMatch) {
      const ordered = !!orderedMatch;
      if (listBuffer.length > 0 && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listBuffer.push((bulletMatch || orderedMatch)[1]);
      i++;
      continue;
    }

    flushList();
    if (line.trim() === '') {
      i++;
      continue;
    }
    blocks.push(
      <p key={`p-${blocks.length}`} style={{ margin: '.4rem 0' }}>
        {renderInline(line, `p-${blocks.length}`)}
      </p>,
    );
    i++;
  }
  flushList();

  return <div>{blocks}</div>;
}
