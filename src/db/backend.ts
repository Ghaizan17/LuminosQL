/** Tauri IPC bridge. Works only inside the desktop shell; `vite dev` in a
 *  browser gets an explicit "desktop backend unavailable" error — never a
 *  fake connection.
 */
import type {
  ConnectionProfile,
  ConnectionView,
  FriendlyError,
  FunctionInfo,
  SchemaInfo,
  ServerInfo,
  TableDef,
  TableInfo,
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
