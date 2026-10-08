/** FROM/JOIN table-reference scanner for alias-aware completion.
 *  Heuristic (regex over de-stringed SQL), not a full parser: good enough to
 *  resolve `alias.` prefixes and unknown-table diagnostics.
 */

export interface TableRef {
  schema?: string;
  table: string;
  /** Effective alias: explicit `AS x` / `x`, else the table name itself. */
  alias: string;
}

/** Keywords that can never be an alias — a following keyword ends the ref. */
const CLAUSE_KEYWORDS = new Set(
  "where group order having limit offset join inner left right full outer cross on using select union intersect except values set returning into from".split(" "),
);

function stripStringsAndComments(sql: string): string {
  // Length-preserving: every removed char becomes a space so match offsets
  // still index into the original SQL.
  const blank = (m: string) => " ".repeat(m.length);
  return sql
    .replace(/--.*$/gm, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/'(?:[^']|'')*'/g, blank)
    .replace(/"(?:[^"]|"")*"/g, blank);
}

function unquote(id: string): string {
  return id.replace(/^"(.*)"$/, "$1").replace(/^`(.*)`$/, "$1").replace(/""/g, '"');
}

export function parseTableRefs(sql: string): TableRef[] {
  const clean = stripStringsAndComments(sql);
  const refs: TableRef[] = [];
  const re = /\b(?:from|join)\s+([A-Za-z_][\w$."]*)(?:\s+(?:as\s+)?([A-Za-z_]\w*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const [name, rawAlias] = [m[1], m[2]];
    const parts = name.split(".").map(unquote);
    const table = parts[parts.length - 1];
    const schema = parts.length > 1 ? parts[parts.length - 2] : undefined;
    const alias =
      rawAlias && !CLAUSE_KEYWORDS.has(rawAlias.toLowerCase()) ? rawAlias : table;
    refs.push({ schema, table, alias });
  }
  return refs;
}

/** Resolve `alias.` (or bare table name) to the referenced table. */
export function resolveAlias(refs: TableRef[], name: string): TableRef | undefined {
  const lower = name.toLowerCase();
  return refs.find((r) => r.alias.toLowerCase() === lower || r.table.toLowerCase() === lower);
}
export interface UnknownTable {
  name: string;
  /** Offset of the table name in the original SQL. */
  offset: number;
}

/**
 * Table names in FROM/JOIN position absent from `known`
 * (lowercase `schema.table` and bare `table` forms). Positions let the
 * editor underline exactly the offending name.
 */
export function findUnknownTables(sql: string, known: Set<string>): UnknownTable[] {
  const clean = stripStringsAndComments(sql);
  const out: UnknownTable[] = [];
  const re = /\b(?:from|join)\s+([A-Za-z_][\w$."]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const raw = m[1];
    const parts = raw.split(".").map(unquote);
    const bare = parts[parts.length - 1].toLowerCase();
    const key = parts.length > 1 ? `${parts[parts.length - 2]}.${bare}` : bare;
    if (!known.has(key) && !known.has(bare)) {
      out.push({ name: parts[parts.length - 1], offset: m.index + m[0].indexOf(raw) });
    }
  }
  return out;
}
