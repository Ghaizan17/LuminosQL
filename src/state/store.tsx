import { createContext, useContext, useReducer, type ReactNode } from "react";

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
  status: { connection: "Not connected (Phase 2)", queryTime: "—", errors: 0 },
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
  | { type: "set-palette"; open: boolean };

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
