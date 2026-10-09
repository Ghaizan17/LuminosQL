/** Mirror of `luminosql-core` connection types (JSON over Tauri IPC). */

export type Engine = "postgres" | "mysql" | "sqlite";

export interface ConnectionProfile {
  id: string;
  name: string;
  engine: Engine;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
}

export interface ServerInfo {
  engine: string;
  version: string;
  latency_ms: number;
}

export interface FriendlyError {
  title: string;
  causes: string[];
  code: string;
}

export interface ConnectionView {
  profile: ConnectionProfile;
  live: boolean;
}

export interface SchemaInfo {
  name: string;
}

export type TableKind = "table" | "view";

export interface TableInfo {
  schema: string;
  name: string;
  kind: TableKind;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  default: string | null;
  pk_position: number | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  ref_schema: string;
  ref_table: string;
  ref_columns: string[];
}

export interface TableDef {
  schema: string;
  name: string;
  kind: TableKind;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
}

export interface FunctionInfo {
  schema: string;
  name: string;
  arguments: string;
  return_type: string;
  language: string;
}

export interface QueryColumn {
  name: string;
  data_type: string;
}

export interface QueryPage {
  columns: QueryColumn[];
  rows: unknown[][];
  rows_affected: number;
  elapsed_ms: number;
  truncated: boolean;
}

export type FilterOp = "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "like" | "isnull" | "isnotnull";

export interface PageFilter {
  column: string;
  op: FilterOp;
  value: string;
}

export interface PageOpts {
  page: number;
  page_size: number;
  sort: { column: string; desc: boolean } | null;
  filters: PageFilter[];
}

export interface TablePage {
  page: QueryPage;
  total_rows: number;
  page_index: number;
  page_size: number;
}

export interface MigrationFile {
  version: string;
  name: string;
  up_sql: string;
  down_sql: string | null;
  checksum: string;
}

export interface MigrationState {
  version: string;
  name: string;
  applied: boolean;
  checksum_ok: boolean;
}

export const ENGINE_DEFAULT_PORT: Record<Engine, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: 0,
};

export function blankProfile(engine: Engine): ConnectionProfile {
  return {
    id: "",
    name: "",
    engine,
    host: engine === "sqlite" ? "" : "127.0.0.1",
    port: ENGINE_DEFAULT_PORT[engine],
    database: engine === "sqlite" ? "" : engine === "postgres" ? "postgres" : "test",
    username: "",
    ssl: false,
  };
}

/** A live PTY owned by the desktop shell. `id` addresses every later call. */
export interface TerminalSession {
  id: string;
  shell: string;
  pid: number;
  cols: number;
  rows: number;
}
