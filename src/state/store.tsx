import { createContext, useContext, useReducer, type ReactNode } from "react";
import type { ConnectionView, Engine, ServerInfo } from "../db/types";

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
  | { type: "connection-dead"; id: string };

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
