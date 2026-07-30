/**
 * Parse RFC 4180-style CSV without third-party code.
 *
 * The parser intentionally rejects malformed quoting and inconsistent column
 * counts so a broken source export cannot silently shift private values into
 * the wrong field.
 */
export function parseCsv(text, sourceName = "CSV input") {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let justClosedQuote = false;
  let line = 1;

  const finishField = () => {
    row.push(field);
    field = "";
    justClosedQuote = false;
  };

  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        field += character;
        if (character === "\n") line += 1;
      }
      continue;
    }

    if (justClosedQuote && character !== "," && character !== "\n" && character !== "\r") {
      throw new Error(`${sourceName}:${line}: unexpected character after closing quote`);
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new Error(`${sourceName}:${line}: quote encountered inside an unquoted field`);
      }
      inQuotes = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\n") {
      finishRow();
      line += 1;
    } else if (character === "\r") {
      if (input[index + 1] === "\n") index += 1;
      finishRow();
      line += 1;
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error(`${sourceName}:${line}: unterminated quoted field`);
  }

  if (field.length > 0 || row.length > 0 || justClosedQuote) {
    finishRow();
  }

  if (rows.length === 0) return [];

  const headers = rows[0];
  if (headers.some((header) => !header)) {
    throw new Error(`${sourceName}: headers must be non-empty`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error(`${sourceName}: duplicate headers are not allowed`);
  }

  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(
        `${sourceName}: record ${index + 2} has ${values.length} fields; expected ${headers.length}`,
      );
    }
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}
