// solve.js — a fast drop-in replacement for csv-reader 1.0.0.
//
// Same answers as csv-reader's readCsv for every input, same {columns, rows, errors}:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, each CRLF or lone CR inside it read as LF; what follows
//     its closing quote, up to the next comma or line break, is appended as it stands
//     (quote_junk, when the field ends); a quote that never closes is a literal
//     character, and the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings,
//     never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are padded with
//     empty strings (short_row, with fields: its field count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row} in the order met, line the 1-based line its
//     record starts on, row its record's index in rows (null for the header).
//
// Speed: the text is read once, left to right, a field at a time. Delimiters are
// found with native indexOf (never a per-character loop): an unquoted field is one
// slice to the next comma or line break, a quoted field one slice to its closing
// quote, and a record with no quote at all is split in one native split(',').
// String building happens only where a field is actually broken (a stray CR, a
// doubled quote, a line break inside quotes, junk after a closing quote).

// How a field ended: at a comma (the record goes on), at a line break or at the
// end of the text (the record ends).
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes
  // (null: the header). Errors are recorded against these.
  let recordLine = 1;
  let recordRow = null;

  // The first LF at or after the current position, for the record being read.
  // It is found once per record (the fast-path check already looks for it) and
  // refreshed only when a quoted field has swallowed it: an unquoted field never
  // passes it without ending the record. This spares one native scan per field.
  let nextLF = -1;

  // Reads an unquoted field starting at pos, appending to `value` ('' for a fresh
  // field, the quoted content for junk after a closing quote, '"' for a quote that
  // never closed). A CR not followed by LF is dropped (stray_cr). Returns
  // {value, ended, added}: added counts the characters kept, not the ones dropped.
  function unquoted(value) {
    if (nextLF !== -1 && pos > nextLF) nextLF = text.indexOf('\n', pos);
    let added = 0;
    const commaIdx = text.indexOf(',', pos);
    const lfIdx = nextLF;
    let end;
    let ended;
    if (commaIdx !== -1 && (lfIdx === -1 || commaIdx < lfIdx)) {
      end = commaIdx;
      ended = COMMA;
    } else if (lfIdx !== -1) {
      end = lfIdx;
      ended = LINE_BREAK;
    } else {
      end = len;
      ended = END;
    }
    // A CR right before the line break is the CRLF's own CR, not a stray one.
    let segEnd = end;
    if (ended === LINE_BREAK && end > pos && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('\r') === -1) {
      value += seg;
      added += seg.length;
    } else {
      // Every CR left in the segment is a stray one: it is followed by a
      // character that is not LF (no LF can sit inside this segment), by a
      // comma, or by the end of the text.
      const n = seg.split('\r').length - 1;
      for (let i = 0; i < n; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      value += seg.replace(/\r/g, '');
      added += seg.length - n;
    }
    if (ended === COMMA) pos = end + 1;
    else if (ended === LINE_BREAK) {
      pos = end + 1;
      line += 1;
    } else {
      pos = end;
    }
    return { value, ended, added };
  }

  // Reads a quoted field whose opening quote is at pos. Returns {value, ended}.
  function quoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    let value = null;
    let segStart = pos;
    let closeIdx = -1;
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after
        // it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return unquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, keep scanning.
        if (value === null) value = text.slice(segStart, q);
        else value += text.slice(segStart, q);
        value += '"';
        pos = q + 2;
        segStart = pos;
        continue;
      }
      closeIdx = q;
      break;
    }
    let content = value === null ? text.slice(segStart, closeIdx) : value + text.slice(segStart, closeIdx);
    if (/[\r\n]/.test(content)) {
      // Each CRLF or lone CR inside the quotes is one LF in the value and one
      // line; each LF is one line.
      const breaks = content.match(/\r\n|\r|\n/g);
      if (breaks !== null) line += breaks.length;
      if (content.indexOf('\r') !== -1) content = content.replace(/\r\n?/g, '\n');
    }
    pos = closeIdx + 1;
    if (pos >= len) return { value: content, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value: content, ended: COMMA };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value: content, ended: LINE_BREAK };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value: content, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break. A stray CR inside it is reported first.
    const junk = unquoted(content);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  // Finishes a record: the header takes the first record's width, the rest are
  // padded or cut to it, with short_row / long_row recorded when the record ends.
  function finish(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a record with no quote before its line break holds no quoted
    // field, so it is one native split. (A quote after the line break belongs
    // to a later record; no quote at all means the rest of the text is free
    // of them.)
    const lfIdx = text.indexOf('\n', pos);
    const quoteIdx = text.indexOf('"', pos);
    if (quoteIdx === -1 || (lfIdx !== -1 && quoteIdx > lfIdx)) {
      let end = lfIdx === -1 ? len : lfIdx;
      let contentEnd = end;
      if (lfIdx !== -1 && end > pos && text.charCodeAt(end - 1) === 13) contentEnd = end - 1;
      let trailingCR = false;
      if (lfIdx === -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) {
        trailingCR = true;
        contentEnd -= 1;
      }
      const content = text.slice(pos, contentEnd);
      pos = lfIdx === -1 ? len : lfIdx + 1;
      if (lfIdx !== -1) line += 1;
      let fields;
      if (content.indexOf('\r') === -1 && !trailingCR) {
        fields = content.split(',');
      } else {
        fields = content.split(',');
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          if (f.indexOf('\r') !== -1) {
            const n = f.split('\r').length - 1;
            for (let k = 0; k < n; k++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            fields[i] = f.replace(/\r/g, '');
          }
        }
        if (trailingCR) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      }
      // A line that held only stray CRs is left with no characters: no record
      // (its stray_cr errors stay).
      if (fields.length === 1 && fields[0] === '') continue;
      finish(fields);
      continue;
    }

    const fields = [];
    let ended;
    let lastQuoted = false;
    nextLF = lfIdx;
    do {
      let f;
      if (text.charCodeAt(pos) === 34) {
        f = quoted();
        lastQuoted = true;
      } else {
        f = unquoted('');
        lastQuoted = false;
      }
      fields.push(f.value);
      ended = f.ended;
    } while (ended === COMMA);

    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    finish(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
