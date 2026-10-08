import type { Action } from "./store";

export interface Command {
  id: string;
  title: string;
  /** Phase that implements it; "1" = works now. */
  phase: string;
  run: (dispatch: React.Dispatch<Action>) => void;
  shortcut?: string;
}

export const COMMANDS: Command[] = [
  { id: "palette", title: "Show Command Palette", phase: "1", run: (d) => d({ type: "set-palette", open: true }), shortcut: "Ctrl+Shift+P" },
  { id: "new-query", title: "New SQL Query", phase: "1", run: (d) => d({ type: "open-tab", tab: { id: `q-${Date.now()}`, title: "query.sql", content: "SELECT 1;\n", kind: "sql" } }) },
  { id: "split", title: "Toggle Split Editor", phase: "1", run: (d) => d({ type: "toggle-split" }) },
  { id: "sidebar", title: "Toggle Sidebar", phase: "1", run: (d) => d({ type: "toggle-sidebar" }), shortcut: "Ctrl+B" },
  { id: "terminal", title: "Toggle Bottom Panel", phase: "1", run: (d) => d({ type: "toggle-bottom" }), shortcut: "Ctrl+`" },
  { id: "theme", title: "Toggle Theme (dark/light)", phase: "1", run: () => setThemeFromPalette() },
  { id: "connect", title: "Create Database Connection", phase: "2", run: (d) => d({ type: "dialog-open", engine: "postgres" }) },
  { id: "run-query", title: "Run Query", phase: "4", run: () => window.dispatchEvent(new CustomEvent("luminos:run-query")), shortcut: "Ctrl+Enter" },
  { id: "format", title: "Format SQL", phase: "4", run: () => window.dispatchEvent(new CustomEvent("luminos:format-sql")) },
  { id: "diagram", title: "Show Database Diagram", phase: "7", run: () => alert("Phase 7: designer not implemented yet.") },
  { id: "export", title: "Export Database", phase: "8", run: () => alert("Phase 8: import/export not implemented yet.") },
];

function setThemeFromPalette() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("luminosql.theme", next);
  window.location.reload();
}

/** Case-insensitive substring match in title order. Pure — unit tested. */
export function filterCommands(q: string, cmds: Command[] = COMMANDS): Command[] {
  const needle = q.trim().toLowerCase().replace(/^>\s*/, "");
  if (!needle) return cmds;
  return cmds.filter((c) => c.title.toLowerCase().includes(needle));
}
