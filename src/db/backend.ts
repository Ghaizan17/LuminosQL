/** Tauri IPC bridge. Works only inside the desktop shell; `vite dev` in a
 *  browser gets an explicit "desktop backend unavailable" error — never a
 *  fake connection.
 */
import type {
  ConnectionProfile,
  ConnectionView,
  FriendlyError,
  FunctionInfo,
  PageOpts,
  QueryPage,
  MigrationFile,
  MigrationState,
  SchemaInfo,
  ServerInfo,
  TableDef,
  TableInfo,
  TablePage,
} from "./types";

declare global {
  interface Window {
    __TAURI__?: { core: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> } };
  }
}

export class DesktopUnavailable extends Error {
  constructor() {
    super("Desktop backend unavailable — run via the Tauri shell (Phase 2 needs `npm run tauri dev`).");
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = window.__TAURI__;
  if (!tauri) throw new DesktopUnavailable();
  return tauri.core.invoke(cmd, args) as Promise<T>;
}

export function isDesktop(): boolean {
  return !!window.__TAURI__;
}

export const backend = {
  createConnection(profile: ConnectionProfile, password: string): Promise<ConnectionProfile> {
    return invoke("create_connection", { profile, password });
  },
  listConnections(): Promise<ConnectionView[]> {
    return invoke("list_connections");
  },
  connect(id: string): Promise<ServerInfo> {
    return invoke("connect", { id });
  },
  disconnect(id: string): Promise<void> {
    return invoke("disconnect", { id });
  },
  deleteConnection(id: string): Promise<void> {
    return invoke("delete_connection", { id });
  },
  credentialStoreStatus(): Promise<boolean> {
    return invoke("credential_store_status");
  },
  classify(sql: string): Promise<boolean> {
    return invoke("classify_statement", { sql });
  },
  listSchemas(id: string): Promise<SchemaInfo[]> {
    return invoke("list_schemas", { id });
  },
  listTables(id: string, schema: string): Promise<TableInfo[]> {
    return invoke("list_tables", { id, schema });
  },
  describeTable(id: string, schema: string, table: string): Promise<TableDef> {
    return invoke("describe_table", { id, schema, table });
  },
  listFunctions(id: string, schema: string): Promise<FunctionInfo[]> {
    return invoke("list_functions", { id, schema });
  },
  tableDdl(id: string, schema: string, table: string): Promise<string> {
    return invoke("table_ddl", { id, schema, table });
  },
  executeSql(id: string, sql: string): Promise<number> {
    return invoke("execute_sql", { id, sql });
  },
  runQuery(id: string, sql: string): Promise<QueryPage> {
    return invoke("run_query", { id, sql });
  },
  tablePage(id: string, schema: string, table: string, opts: PageOpts): Promise<TablePage> {
    return invoke("table_page", { id, schema, table, opts });
  },
  updateCell(id: string, schema: string, table: string, pk: [string, string | null][], column: string, value: string | null): Promise<number> {
    return invoke("update_cell", { id, schema, table, pk, column, value });
  },
  deleteRow(id: string, schema: string, table: string, pk: [string, string | null][]): Promise<number> {
    return invoke("delete_row", { id, schema, table, pk });
  },
  insertRow(id: string, schema: string, table: string, values: [string, string | null][]): Promise<number> {
    return invoke("insert_row", { id, schema, table, values });
  },
  listMigrations(dir: string): Promise<MigrationFile[]> {
    return invoke("list_migrations", { dir });
  },
  migrationStatus(id: string, dir: string): Promise<MigrationState[]> {
    return invoke("migration_status", { id, dir });
  },
  migrateUp(id: string, dir: string, version: string): Promise<void> {
    return invoke("migrate_up", { id, dir, version });
  },
  migrateDown(id: string, dir: string, version: string): Promise<void> {
    return invoke("migrate_down", { id, dir, version });
  },
  createMigration(dir: string, name: string): Promise<MigrationFile> {
    return invoke("create_migration", { dir, name });
  },
  workspaceSave(dir: string, payload: string): Promise<void> {
    return invoke("workspace_save", { dir, payload });
  },
  workspaceOpen(dir: string): Promise<string> {
    return invoke("workspace_open", { dir });
  },
  aiKeySave(key: string): Promise<void> {
    return invoke("ai_key_save", { key });
  },
  aiKeyGet(): Promise<string | null> {
    return invoke("ai_key_get");
  },
  aiKeySaved(): Promise<boolean> {
    return invoke("ai_key_saved");
  },
};

export function toFriendlyError(e: unknown): FriendlyError {
  if (e instanceof DesktopUnavailable) {
    return { title: e.message, causes: [], code: "no-desktop" };
  }
  if (typeof e === "string") {
    try {
      const parsed = JSON.parse(e) as FriendlyError;
      if (parsed.title) return parsed;
    } catch {
      /* plain string */
    }
    return { title: e, causes: [], code: "unknown" };
  }
  if (e && typeof e === "object" && "title" in e) return e as FriendlyError;
  return { title: String(e), causes: [], code: "unknown" };
}
