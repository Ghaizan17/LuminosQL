import { Suspense, lazy, useCallback, useEffect } from "react";
import { backend, toFriendlyError } from "../db/backend";
import { formatSql } from "../sql/format";
import { logger } from "../dx/logger";
import { useStore, type Action } from "../state/store";
import { DataGrid } from "./DataGrid";
import { Designer } from "./Designer";

// Monaco (~4 MB) loads after the shell paints — startup stays instant.
const SqlEditor = lazy(() =>
  import("../editor/SqlEditor").then((m) => ({ default: m.SqlEditor })),
);

/** Run the given SQL on the active connection and record the outcome. */
async function execute(
  tabId: string,
  sql: string,
  connName: string | null,
  connId: string | null,
  safeMode: boolean,
  dispatch: React.Dispatch<Action>,
) {
  if (!connId) {
    dispatch({
      type: "query-done",
      tabId,
      result: {
        sql,
        columns: [],
        rows: [],
        rowsAffected: 0,
        elapsedMs: 0,
        truncated: false,
        running: false,
        error: { title: "Not connected.", causes: ["Connect first (sidebar +), then run."], code: "not-connected" },
      },
    });
    return;
  }
  const statement = sql.trim();
  if (!statement) return;
  if (safeMode) {
    try {
      if (await backend.classify(statement)) {
        const blocked = {
          title: "Blocked by Safe Mode.",
          causes: ["This statement may modify data.", "Disable Safe Mode in Settings to run it."],
          code: "safe-mode",
        };
        dispatch({ type: "query-done", tabId, result: { sql: statement, columns: [], rows: [], rowsAffected: 0, elapsedMs: 0, truncated: false, running: false, error: blocked } });
        return;
      }
    } catch {
      /* classifier unavailable (browser mode) — fall through to run attempt */
    }
  }
  const start = performance.now();
  const finish = (elapsedMs: number, ok: boolean) =>
    dispatch({ type: "history-record", sql: statement, connection: connName ?? "—", elapsedMs, ok });
  try {
    const page = await backend.runQuery(connId, statement);
    const elapsedMs = Math.round(performance.now() - start);
    finish(elapsedMs, true);
    dispatch({
      type: "query-done",
      tabId,
      result: {
        sql: statement,
        columns: page.columns.map((c) => c.name),
        rows: page.rows,
        rowsAffected: page.rows_affected,
        elapsedMs,
        truncated: page.truncated,
        running: false,
      },
    });
  } catch (e) {
    const elapsedMs = Math.round(performance.now() - start);
    finish(elapsedMs, false);
    logger.error("query", `${toFriendlyError(e).title} :: ${statement.slice(0, 200)}`);
    dispatch({
      type: "query-done",
      tabId,
      result: {
        sql: statement,
        columns: [],
        rows: [],
        rowsAffected: 0,
        elapsedMs,
        truncated: false,
        running: false,
        error: toFriendlyError(e),
      },
    });
  }
}

function Pane({ tabId }: { tabId: string }) {
  const { state, dispatch } = useStore();
  const tab = state.tabs.find((t) => t.id === tabId);

  const run = useCallback(
    (sql: string) => {
      const view = state.connections.find((c) => c.profile.id === state.activeConnectionId);
      void execute(tabId, sql, view?.live ? view.profile.name : null, view?.live ? view.profile.id : null, state.settings.safeMode, dispatch);
    },
    [dispatch, state.activeConnectionId, state.connections, state.settings.safeMode, tabId],
  );

  // Palette / shortcut bridge: commands dispatch window events (they hold no state).
  useEffect(() => {
    const onRun = () => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (current && current.kind === "sql" && state.activeTabId === tabId) run(current.content);
    };
    const onFormat = () => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (current && current.kind === "sql" && state.activeTabId === tabId) {
        dispatch({ type: "edit-tab", id: tabId, content: formatSql(current.content) });
      }
    };
    window.addEventListener("luminos:run-query", onRun);
    window.addEventListener("luminos:format-sql", onFormat);
    return () => {
      window.removeEventListener("luminos:run-query", onRun);
      window.removeEventListener("luminos:format-sql", onFormat);
    };
  }, [dispatch, run, state.activeTabId, state.tabs, tabId]);

  if (!tab) return <div className="placeholder">No file open. Ctrl+P → New SQL Query.</div>;
  if (tab.kind === "data" && tab.dataRef) {
    return (
      <div className="pane-editor">
        <DataGrid dataRef={tab.dataRef} />
      </div>
    );
  }
  if (tab.kind === "design" && tab.designRef) {
    const view = state.connections.find((c) => c.profile.id === tab.designRef!.connId);
    return (
      <div className="pane-editor">
        <Designer designRef={tab.designRef} engine={view?.profile.engine ?? "postgres"} />
      </div>
    );
  }
  const conn = state.connections.find((c) => c.profile.id === state.activeConnectionId);
  return (
    <div className="pane-editor">
      <div className="editor-toolbar">
        <button className="run" title="Run query (Ctrl+Enter)" onClick={() => run(tab.content)}>
          ▶ Run
        </button>
        <button title="Format SQL" onClick={() => dispatch({ type: "edit-tab", id: tabId, content: formatSql(tab.content) })}>
          Format
        </button>
        <span className="conn-label">{conn?.live ? conn.profile.name : "Not connected"}</span>
      </div>
      <div className="pane-monaco">
        <Suspense fallback={<div className="placeholder">Loading editor…</div>}>
          <SqlEditor tabId={tab.id} value={tab.content} onRun={run} />
        </Suspense>
      </div>
    </div>
  );
}

export function EditorArea() {
  const { state, dispatch } = useStore();
  return (
    <div className="editor">
      <div className="tabs" role="tablist">
        {state.tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === state.activeTabId}
            className={t.id === state.activeTabId ? "tab active" : "tab"}
            onClick={() => dispatch({ type: "set-active", id: t.id })}
          >
            {t.title}
            <button
              className="close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "close-tab", id: t.id });
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="split">
        <div className="pane">
          {state.activeTabId ? <Pane tabId={state.activeTabId} /> : <div className="placeholder">No file open.</div>}
        </div>
        {state.splitTabId && (
          <div className="pane">
            <Pane tabId={state.splitTabId} />
          </div>
        )}
      </div>
    </div>
  );
}
