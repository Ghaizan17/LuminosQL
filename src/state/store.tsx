import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { ConnectionView, Engine, FriendlyError, ServerInfo, TableDef } from "../db/types";

export type TreeKind =
  | "schemas" | "schema" | "group-tables" | "group-views" | "group-funcs"
  | "table" | "view" | "function" | "group-cols" | "col" | "group-idx" | "idx"
  | "group-fk" | "fk";

export interface TreeNode {
  key: string;
  label: string;
  kind: TreeKind;
  detail?: string;
  connId: string;
  schema?: string;
  table?: string;
}

export interface NodeCache {
  status: "loading" | "ready" | "error";
  error?: FriendlyError;
  items: TreeNode[];
}

export type Theme = "dark" | "light";
export type ActivityView = "explorer" | "search" | "migrations" | "history" | "settings";

export interface EditorTab {
  id: string;
  title: string;
  /** SQL text; Phase 4 replaces PlainEditor with Monaco behind the same tab model. */
  content: string;
}

export interface ShellState {
  theme: Theme;
  activity: ActivityView;
  sidebarVisible: boolean;
  bottomVisible: boolean;
  bottomTab: "problems" | "output" | "terminal";
  tabs: EditorTab[];
  activeTabId: string | null;
  /** Second column of the split editor; null = single pane. */
  splitTabId: string | null;
  paletteOpen: boolean;
  status: { connection: string; queryTime: string; errors: number };
  connections: ConnectionView[];
  activeConnectionId: string | null;
  lastServerInfo: ServerInfo | null;
  /** Null = dialog closed; otherwise the engine preselected in the form. */
  connDialog: { engine: Engine } | null;
  /** Null = unknown (not a desktop shell); true = OS keyring. */
  storeOsBacked: boolean | null;
  /** Lazy explorer cache: node key → children. Missing = never loaded. */
  explorer: Record<string, NodeCache>;
  expanded: Record<string, true>;
  /** describe_table results by `table:{conn}:{schema}:{table}` key. */
  defs: Record<string, TableDef>;
}

const initial: ShellState = {
  theme:
    typeof localStorage === "undefined"
      ? "dark"
      : ((localStorage.getItem("luminosql.theme") as Theme) || "dark"),
  activity: "explorer",
  sidebarVisible: true,
  bottomVisible: true,
  bottomTab: "output",
  tabs: [
    {
      id: "welcome",
      title: "welcome.sql",
      content: "-- Welcome to LuminosQL (Phase 1 shell)\n-- Connect (Phase 2) → Explore (Phase 3) → Query (Phase 4).\nSELECT * FROM users;\n",
    },
  ],
  activeTabId: "welcome",
  splitTabId: null,
  paletteOpen: false,
  status: { connection: "Not connected", queryTime: "—", errors: 0 },
  connections: [],
  activeConnectionId: null,
  lastServerInfo: null,
  connDialog: null,
  storeOsBacked: null,
  explorer: {},
  expanded: {},
  defs: {},
};

export type Action =
  | { type: "set-theme"; theme: Theme }
  | { type: "set-activity"; activity: ActivityView }
  | { type: "toggle-sidebar" }
  | { type: "toggle-bottom" }
  | { type: "set-bottom-tab"; tab: ShellState["bottomTab"] }
  | { type: "open-tab"; tab: EditorTab }
  | { type: "close-tab"; id: string }
  | { type: "set-active"; id: string }
  | { type: "edit-tab"; id: string; content: string }
  | { type: "toggle-split" }
  | { type: "set-palette"; open: boolean }
  | { type: "connections-loaded"; views: ConnectionView[]; storeOsBacked: boolean | null }
  | { type: "dialog-open"; engine: Engine }
  | { type: "dialog-close" }
  | { type: "connection-live"; id: string; info: ServerInfo }
  | { type: "connection-dead"; id: string }
  | { type: "tree-toggle"; key: string }
  | { type: "tree-loading"; key: string }
  | { type: "tree-ready"; key: string; items: TreeNode[] }
  | { type: "tree-failed"; key: string; error: FriendlyError }
  | { type: "tree-def"; key: string; def: TableDef }
  | { type: "tree-drop"; match: string };

export function reducer(s: ShellState, a: Action): ShellState {
  switch (a.type) {
    case "set-theme":
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("luminosql.theme", a.theme);
        document.documentElement.dataset.theme = a.theme;
      }
      return { ...s, theme: a.theme };
    case "set-activity":
      return { ...s, activity: a.activity, sidebarVisible: true };
    case "toggle-sidebar":
      return { ...s, sidebarVisible: !s.sidebarVisible };
    case "toggle-bottom":
      return { ...s, bottomVisible: !s.bottomVisible };
    case "set-bottom-tab":
      return { ...s, bottomTab: a.tab, bottomVisible: true };
    case "open-tab":
      return {
        ...s,
        tabs: s.tabs.some((t) => t.id === a.tab.id) ? s.tabs : [...s.tabs, a.tab],
        activeTabId: a.tab.id,
      };
    case "close-tab": {
      const tabs = s.tabs.filter((t) => t.id !== a.id);
      return {
        ...s,
        tabs,
        activeTabId: s.activeTabId === a.id ? tabs[tabs.length - 1]?.id ?? null : s.activeTabId,
        splitTabId: s.splitTabId === a.id ? null : s.splitTabId,
      };
    }
    case "set-active":
      return { ...s, activeTabId: a.id };
    case "edit-tab":
      return { ...s, tabs: s.tabs.map((t) => (t.id === a.id ? { ...t, content: a.content } : t)) };
    case "toggle-split":
      return { ...s, splitTabId: s.splitTabId ? null : s.activeTabId };
    case "set-palette":
      return { ...s, paletteOpen: a.open };
    case "connections-loaded": {
      const liveById: Record<string, true> = {};
      for (const v of a.views) if (v.live) liveById[v.profile.id] = true;
      return {
        ...s,
        connections: a.views,
        storeOsBacked: a.storeOsBacked,
        activeConnectionId: s.activeConnectionId && liveById[s.activeConnectionId] ? s.activeConnectionId : null,
      };
    }
    case "dialog-open":
      return { ...s, connDialog: { engine: a.engine } };
    case "dialog-close":
      return { ...s, connDialog: null };
    case "connection-live": {
      const view = s.connections.find((v) => v.profile.id === a.id);
      return {
        ...s,
        connections: s.connections.map((v) => (v.profile.id === a.id ? { ...v, live: true } : v)),
        activeConnectionId: a.id,
        lastServerInfo: a.info,
        status: {
          ...s.status,
          connection: view ? `${view.profile.name} (${a.info.engine} ${a.info.version})` : s.status.connection,
          queryTime: `${a.info.latency_ms} ms`,
        },
      };
    }
    case "connection-dead":
      return {
        ...s,
        connections: s.connections.map((v) => (v.profile.id === a.id ? { ...v, live: false } : v)),
        activeConnectionId: s.activeConnectionId === a.id ? null : s.activeConnectionId,
        status: s.activeConnectionId === a.id ? { ...s.status, connection: "Not connected" } : s.status,
      };
    case "tree-toggle": {
      const expanded = { ...s.expanded };
      if (expanded[a.key]) delete expanded[a.key];
      else expanded[a.key] = true;
      return { ...s, expanded };
    }
    case "tree-loading":
      return { ...s, explorer: { ...s.explorer, [a.key]: { status: "loading", items: [] } } };
    case "tree-ready":
      return { ...s, explorer: { ...s.explorer, [a.key]: { status: "ready", items: a.items } } };
    case "tree-failed":
      return { ...s, explorer: { ...s.explorer, [a.key]: { status: "error", error: a.error, items: [] } } };
    case "tree-def":
      return { ...s, defs: { ...s.defs, [a.key]: a.def } };
    case "tree-drop": {
      // Substring match: keys embed `:{conn}:{schema}…` segments rather than nesting.
      // May over-invalidate on name prefixes — harmless, children reload lazily.
      const explorer = { ...s.explorer };
      const defs = { ...s.defs };
      for (const k of Object.keys(explorer)) if (k.includes(a.match)) delete explorer[k];
      for (const k of Object.keys(defs)) if (k.includes(a.match)) delete defs[k];
      return { ...s, explorer, defs };
    }
  }
}

const Ctx = createContext<{ state: ShellState; dispatch: React.Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}
