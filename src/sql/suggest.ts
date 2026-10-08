/** Cursor-context suggestion builder (Monaco-agnostic; the provider module maps
 *  these onto CompletionItems). Pure and unit-tested.
 */
import { parseTableRefs, resolveAlias } from "./aliases";
import { keywordProvider } from "./completion";
import type { ColumnInfo } from "../db/types";

export interface TableSummary {
  schema: string;
  name: string;
}

export interface SchemaSnapshot {
  tables: TableSummary[];
  columnsByTable: Record<string, ColumnInfo[]>;
  defaultSchema: string;
}

export interface Suggestion {
  label: string;
  kind: "keyword" | "table" | "column" | "function" | "schema";
  detail?: string;
}

function columnsOf(snap: SchemaSnapshot, schema: string | undefined, table: string): ColumnInfo[] {
  const key = `${schema ?? snap.defaultSchema}.${table}`.toLowerCase();
  return snap.columnsByTable[key] ?? [];
}

export function suggestFor(sql: string, offset: number, snap: SchemaSnapshot): Suggestion[] {
  const before = sql.slice(0, offset);

  // `alias.|column-prefix` → columns of the aliased table.
  const qualified = before.match(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)?$/);
  if (qualified) {
    const ref = resolveAlias(parseTableRefs(sql), qualified[1]);
    if (ref) {
      const cols = columnsOf(snap, ref.schema, ref.table);
      const prefix = (qualified[2] ?? "").toLowerCase();
      return cols
        .filter((c) => c.name.toLowerCase().startsWith(prefix))
        .map((c) => ({
          label: c.name,
          kind: "column" as const,
          detail: `${c.data_type}${c.pk_position ? " 🔑" : ""}`,
        }));
    }
    return [];
  }

  // Inside a FROM/JOIN list → table names.
  const statement = before.split(";").pop() ?? "";
  if (/(?:from|join)\s+[^\s;]*$/i.test(statement) || /(?:from|join)\s+.*,\s*[^\s,;]*$/i.test(statement)) {
    const prefix = (statement.match(/([A-Za-z_]\w*)$/)?.[1] ?? "").toLowerCase();
    return snap.tables
      .filter((t) => t.name.toLowerCase().startsWith(prefix))
      .map((t) => ({ label: t.name, kind: "table" as const, detail: t.schema }));
  }

  // Open context: keywords + tables + schema-qualified fallback.
  const prefix = (before.match(/([A-Za-z_]\w*)$/)?.[1] ?? "").toLowerCase();
  const keywords = keywordProvider
    .complete(prefix)
    .filter((k) => k.kind === "keyword")
    .map((k) => ({ label: k.label, kind: "keyword" as const }));
  const tables = snap.tables
    .filter((t) => t.name.toLowerCase().startsWith(prefix))
    .map((t) => ({ label: t.name, kind: "table" as const, detail: t.schema }));
  return [...keywords, ...tables];
}
