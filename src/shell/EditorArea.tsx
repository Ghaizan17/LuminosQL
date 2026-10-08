import { Suspense, lazy, useCallback, useEffect } from "react";
import { backend, toFriendlyError } from "../db/backend";
import { formatSql } from "../sql/format";
import { useStore, type Action } from "../state/store";

// Monaco (~4 MB) loads after the shell paints — startup stays instant.
const SqlEditor = lazy(() =>
  import("../editor/SqlEditor").then((m) => ({ default: m.SqlEditor })),
);

/** Run the given SQL on the active connection and record the outcome. */
async function execute(
  tabId: string,
  sql: string,
  connId: string | null,
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
  dispatch({ type: "query-started", tabId, sql: statement });
  const start = performance.now();
  try {
    const page = await backend.runQuery(connId, statement);
    dispatch({
      type: "query-done",
      tabId,
      result: {
        sql: statement,
        columns: page.columns.map((c) => c.name),
        rows: page.rows,
        rowsAffected: page.rows_affected,
        elapsedMs: Math.round(performance.now() - start),
        truncated: page.truncated,
        running: false,
      },
    });
  } catch (e) {
    dispatch({
      type: "query-done",
      tabId,
      result: {
        sql: statement,
        columns: [],
        rows: [],
        rowsAffected: 0,
        elapsedMs: Math.round(performance.now() - start),
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
      void execute(tabId, sql, view?.live ? view.profile.id : null, dispatch);
    },
    [dispatch, state.activeConnectionId, state.connections, tabId],
  );

  // Palette / shortcut bridge: commands dispatch window events (they hold no state).
  useEffect(() => {
    const onRun = () => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (current && state.activeTabId === tabId) run(current.content);
    };
    const onFormat = () => {
      const current = state.tabs.find((t) => t.id === tabId);
      if (current && state.activeTabId === tabId) {
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
