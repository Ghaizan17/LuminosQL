/** Client-side DDL builders for the New/Rename/Drop table dialogs.
 *  Quoting mirrors `src-core/src/db/ddl.rs`. The preview shown in the dialog
 *  is exactly what gets executed — no hidden normalization.
 */
import type { Engine } from "./types";

export interface ColumnSpec {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
}

export function quoteIdent(name: string, engine: Engine): string {
  if (engine === "mysql") return `\`${name.replace(/`/g, "``")}\``;
  return `"${name.replace(/"/g, '""')}"`;
}

export function qualified(schema: string, table: string, engine: Engine): string {
  if (engine === "sqlite" || !schema) return quoteIdent(table, engine);
  return `${quoteIdent(schema, engine)}.${quoteIdent(table, engine)}`;
}

export function buildCreateTable(
  engine: Engine,
  schema: string,
  table: string,
  columns: ColumnSpec[],
): string {
  const pk = columns.filter((c) => c.primaryKey);
  const lines = columns.map((c, i) => {
    let line = `    ${quoteIdent(c.name, engine)} ${c.dataType || "TEXT"}`;
    if (pk.length === 1 && c.primaryKey) line += " PRIMARY KEY";
    if (!c.nullable) line += " NOT NULL";
    if (c.defaultValue.trim()) line += ` DEFAULT ${c.defaultValue.trim()}`;
    const last = i === columns.length - 1 && pk.length <= 1;
    return line + (last ? "" : ",");
  });
  if (pk.length > 1) {
    lines.push(`    PRIMARY KEY (${pk.map((c) => quoteIdent(c.name, engine)).join(", ")})`);
  }
  return `CREATE TABLE ${qualified(schema, table, engine)} (\n${lines.join("\n")}\n);`;
}

export function buildRenameTable(engine: Engine, schema: string, from: string, to: string): string {
  return `ALTER TABLE ${qualified(schema, from, engine)} RENAME TO ${quoteIdent(to, engine)};`;
}

export function buildDropTable(engine: Engine, schema: string, table: string): string {
  return `DROP TABLE ${qualified(schema, table, engine)};`;
}

export function buildSelectAll(engine: Engine, schema: string, table: string): string {
  return `SELECT * FROM ${qualified(schema, table, engine)};`;
}
