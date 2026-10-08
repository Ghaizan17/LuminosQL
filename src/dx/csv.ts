/** Minimal CSV: parse (quoted fields, doubled quotes, CRLF) + serialize. */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const push = () => {
    row.push(field);
    field = "";
  };
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
    } else if (c === '"') {
      quoted = true;
      i += 1;
    } else if (c === ",") {
      push();
      i += 1;
    } else if (c === "\r" && text[i + 1] === "\n") {
      push();
      rows.push(row);
      row = [];
      i += 2;
    } else if (c === "\n") {
      push();
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }
  push();
  rows.push(row);
  // Drop the phantom row from a trailing newline.
  if (rows.length > 0 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
    rows.pop();
  }
  return rows;
}

export function toCsvRow(cells: string[]): string {
  return cells.map((s) => `"${s.replace(/"/g, '""')}"`).join(",");
}
