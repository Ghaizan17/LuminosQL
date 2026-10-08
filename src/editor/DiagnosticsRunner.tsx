import { useEffect } from "react";
import { backend, toFriendlyError } from "../db/backend";
import { findUnknownTables } from "../sql/aliases";
import { useStore, type Problem } from "../state/store";

function offsetToLineCol(sql: string, offset: number): { line: number; column: number } {
  const before = sql.slice(0, Math.max(0, offset));
  const line = before.split("\n").length;
  const column = offset - (before.lastIndexOf("\n") + 1) + 1;
  return { line, column };
}

function explainable(sql: string): boolean {
  return /^\s*\(?\s*(select|with|values|explain)\b/i.test(sql);
}

function serverLine(message: string): number {
  const m = message.match(/LINE (\d+)/);
  return m ? Number(m[1]) : 1;
}

/** Debounced diagnostics for every open tab: instant client checks plus
 *  server EXPLAIN errors. Never flags what it cannot know — with no loaded
 *  schema and no connection, a tab stays clean.
 */
export function DiagnosticsRunner() {
  const { state, dispatch } = useStore();

  useEffect(() => {
    const timer = setTimeout(() => {
      void (async () => {
        const view = state.connections.find((c) => c.profile.id === state.activeConnectionId);
        const live = view?.live ? view : null;

        const known = new Set<string>();
        for (const cache of Object.values(state.explorer)) {
          for (const n of cache.items) {
            if ((n.kind === "table" || n.kind === "view") && n.schema && n.table) {
              known.add(`${n.schema}.${n.table}`.toLowerCase());
              known.add(n.table.toLowerCase());
            }
          }
        }

        for (const tab of state.tabs) {
          if (!tab.content.trim()) {
            dispatch({ type: "problems-set", tabId: tab.id, problems: [] });
            continue;
          }
          const problems: Problem[] = [];
          if (known.size > 0) {
            for (const u of findUnknownTables(tab.content, known)) {
              const { line, column } = offsetToLineCol(tab.content, u.offset);
              problems.push({
                line,
                column,
                message: `Table "${u.name}" not found in the loaded schema.`,
                severity: "error",
              });
            }
          }
          if (live && explainable(tab.content)) {
            const first = tab.content.split(";")[0];
            try {
              await backend.executeSql(live.profile.id, `EXPLAIN ${first}`);
            } catch (e) {
              const fe = toFriendlyError(e);
              if (fe.code !== "no-desktop") {
                problems.push({
                  line: serverLine([fe.title, ...fe.causes].join("\n")),
                  column: 1,
                  message: fe.title,
                  severity: "error",
                });
              }
            }
          }
          const prev = state.problems[tab.id] ?? [];
          if (JSON.stringify(prev) !== JSON.stringify(problems)) {
            dispatch({ type: "problems-set", tabId: tab.id, problems });
          }
        }
      })();
    }, 800);
    return () => clearTimeout(timer);
  }, [state.tabs, state.connections, state.activeConnectionId, state.explorer, state.problems, dispatch]);

  return null;
}
