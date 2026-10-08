/** Workspace save/restore: `.database/config.json` holds profiles (sans
 *  secrets — ids are stable so the keyring still matches), SQL tabs, and
 *  the migrations dir. Cold-start open restores tabs + connections.
 */
import { backend } from "../db/backend";
import type { ConnectionProfile } from "../db/types";
import type { Action, ShellState } from "../state/store";

export interface WorkspacePayload {
  version: 1;
  connections: ConnectionProfile[];
  tabs: { title: string; content: string }[];
  migrationsDir: string;
}

export const WORKSPACE_KEY = "luminosql.workspaceDir";

export function buildPayload(state: ShellState, migrationsDir: string): WorkspacePayload {
  return {
    version: 1,
    connections: state.connections.map((c) => c.profile),
    tabs: state.tabs.filter((t) => t.kind === "sql").map((t) => ({ title: t.title, content: t.content })),
    migrationsDir,
  };
}

/** Restore profiles (no password → keyring entries survive), tabs, and dir. */
export async function applyPayload(raw: string, dispatch: React.Dispatch<Action>): Promise<string> {
  const payload = JSON.parse(raw) as WorkspacePayload;
  if (payload.version !== 1 || !Array.isArray(payload.connections)) {
    throw new Error("Unsupported workspace file (expected version 1).");
  }
  for (const profile of payload.connections) {
    await backend.createConnection(profile, "");
  }
  const views = await backend.listConnections();
  const storeOsBacked = await backend.credentialStoreStatus().catch(() => null);
  dispatch({ type: "connections-loaded", views, storeOsBacked });
  for (const t of payload.tabs.slice(0, 20)) {
    dispatch({
      type: "open-tab",
      tab: { id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`, title: t.title, content: t.content, kind: "sql" },
    });
  }
  try {
    localStorage.setItem("luminosql.migrationsDir", payload.migrationsDir ?? "");
  } catch {
    /* private mode */
  }
  return payload.migrationsDir ?? "";
}
