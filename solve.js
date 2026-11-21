// solve.js — a fast drop-in for make.fun's csv-reader 1.0.0.
//
// It returns the reference's answer for every input, reached a different
// way: the reference walks the text one character at a time, building each
// field up a character at a time; this reader jumps from delimiter to
// delimiter with the string's own search, and takes a whole clean line in
// one split. The policy it implements is the reference's, kept exactly:
//
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled ("" inside it is one quote); each CRLF or lone CR inside it
//     reads as LF; what follows its closing quote, up to the next comma or
//     line break, is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal character and the text
//     after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded (short_row) or cut (long_row) to the
//     first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on, row its record's index in rows (null for the header), in
//     the order met.
//
// Delimiter codes, so the hot loop compares numbers, not one-character strings.
const COMMA = 44; // ,
const LF = 10; // \n
const CR = 13; // \r
const QUOTE = 34; // "

/** csv-reader 1.0.0's reading of one CSV input, {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === LF) {
        pos += 1;
        line += 1;
      } else if (c === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    // Fast path: one clean physical line is one record. A line is clean
    // when it holds no quote (so no field opens quoted and none spans a
    // line) and no CR except a trailing one before its LF (a CRLF ending).
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? len : nl;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1) {
      const r = seg.indexOf('\r');
      if (r === -1 || (r === seg.length - 1 && nl !== -1)) {
        const body = r === -1 ? seg : seg.slice(0, -1);
        const fields = body.split(',');
        if (fields.length === 1 && fields[0] === '') {
          // A line left with no characters is no record.
          pos = nl === -1 ? len : nl + 1;
          if (nl !== -1) line += 1;
          continue;
        }
        if (width < 0) width = fields.length;
        if (header && columns === null) {
          columns = fields;
        } else {
          if (fields.length < width) {
            errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
            while (fields.length < width) fields.push('');
          } else if (fields.length > width) {
            errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
          }
          rows.push(fields);
        }
        pos = nl === -1 ? len : nl + 1;
        if (nl !== -1) line += 1;
        continue;
      }
    }

    // Slow path: one record, field by field. A quoted field that ends in
    // junk, or never closes, hands its value to the unquoted scan below
    // through `carry` instead of duplicating that scan.
    const fields = [];
    let lastQuoted = false;
    let ended = 0;
    let carry = null; // [value, junkCheck] or null
    for (;;) {
      let value;
      let junkCheck = false;
      if (carry !== null) {
        value = carry[0];
        junkCheck = carry[1];
        carry = null;
      } else if (text.charCodeAt(pos) === QUOTE) {
        lastQuoted = true;
        const open = pos;
        let pieces = null;
        let segStart = pos + 1;
        let p = pos + 1;
        let closedAt = -1;
        for (;;) {
          const q = text.indexOf('"', p);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === QUOTE) {
            // A doubled quote is one literal quote inside the field.
            pieces = (pieces === null ? '' : pieces) + text.slice(segStart, q) + '"';
            p = q + 2;
            segStart = q + 2;
            continue;
          }
          closedAt = q;
          break;
        }
        if (closedAt === -1) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          carry = ['"', false];
          pos = open + 1;
          continue;
        }
        let raw = pieces === null ? text.slice(segStart, closedAt) : pieces + text.slice(segStart, closedAt);
        if (raw.indexOf('\r') !== -1) {
          // Each CRLF or lone CR inside quotes reads as one LF.
          const breaks = raw.match(/\r\n|\r|\n/g);
          line += breaks === null ? 0 : breaks.length;
          raw = raw.replace(/\r\n?/g, '\n');
        } else if (raw.indexOf('\n') !== -1) {
          line += raw.split('\n').length - 1;
        }
        pos = closedAt + 1;
        if (pos >= len) {
          fields.push(raw);
          ended = 2;
          break;
        }
        const c = text.charCodeAt(pos);
        if (c === COMMA) {
          fields.push(raw);
          pos += 1;
          ended = 0;
          continue;
        }
        if (c === LF) {
          fields.push(raw);
          pos += 1;
          line += 1;
          ended = 1;
          break;
        }
        if (c === CR && pos + 1 < len && text.charCodeAt(pos + 1) === LF) {
          fields.push(raw);
          pos += 2;
          line += 1;
          ended = 1;
          break;
        }
        // What follows the closing quote is appended as it stands.
        carry = [raw, true];
        continue;
      } else {
        lastQuoted = false;
        value = '';
      }

      // Unquoted scan from pos, appending to value. The field runs to the
      // nearest comma or line break; a CR inside it that is not part of a
      // CRLF ending is dropped (stray_cr), and a trailing CR before a LF
      // is the CRLF ending itself, not a stray one.
      let added = 0;
      const start = pos;
      const cIdx = text.indexOf(',', pos);
      const nIdx = text.indexOf('\n', pos);
      let m;
      let isComma;
      if (cIdx === -1) {
        m = nIdx;
        isComma = false;
      } else if (nIdx === -1) {
        m = cIdx;
        isComma = true;
      } else if (cIdx < nIdx) {
        m = cIdx;
        isComma = true;
      } else {
        m = nIdx;
        isComma = false;
      }
      if (m === -1) {
        let tail = text.slice(start);
        const ri = tail.indexOf('\r');
        if (ri !== -1) {
          const parts = tail.split('\r');
          for (let i = 1; i < parts.length; i++) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
          tail = parts.join('');
        }
        value += tail;
        added += tail.length;
        pos = len;
        ended = 2;
      } else if (isComma) {
        let chunk = text.slice(start, m);
        const ri = chunk.indexOf('\r');
        if (ri !== -1) {
          const parts = chunk.split('\r');
          for (let i = 1; i < parts.length; i++) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
          chunk = parts.join('');
        }
        value += chunk;
        added += chunk.length;
        pos = m + 1;
        ended = 0;
      } else {
        let chunk = text.slice(start, m);
        if (chunk.length > 0 && chunk.charCodeAt(chunk.length - 1) === CR) chunk = chunk.slice(0, -1);
        const ri = chunk.indexOf('\r');
        if (ri !== -1) {
          const parts = chunk.split('\r');
          for (let i = 1; i < parts.length; i++) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
          chunk = parts.join('');
        }
        value += chunk;
        added += chunk.length;
        pos = m + 1;
        line += 1;
        ended = 1;
      }
      if (junkCheck && added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      fields.push(value);
      if (ended === 0) continue;
      break;
    }

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
