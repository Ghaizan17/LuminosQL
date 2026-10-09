import { useCallback, useEffect, useRef, useState } from "react";
import { backend, isDesktop } from "../db/backend";
import type { TerminalSession } from "../db/types";
import { useStore } from "../state/store";
import { TerminalView } from "./TerminalView";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function Results() {
  const { state } = useStore();
  const result = state.activeTabId ? state.results[state.activeTabId] : undefined;
  if (!result) {
    return <div>Run a query with Ctrl+Enter — results land here.</div>;
  }
  if (result.running) return <div>Running…</div>;
  if (result.error) {
    return (
      <div className="result-error" role="alert">
        <strong>✕ Query failed ({result.elapsedMs} ms)</strong>
        <div>{result.error.title}</div>
        {result.error.causes.map((c) => (
          <div key={c}>• {c}</div>
        ))}
      </div>
    );
  }
  if (result.columns.length === 0) {
    return <div>✓ {result.rowsAffected} row(s) affected · {result.elapsedMs} ms</div>;
  }
  return (
    <div>
      <div className="result-meta">
        ✓ {result.rows.length} row(s){result.truncated ? " (first 500 — refine with LIMIT)" : ""} · {result.elapsedMs} ms
      </div>
      <table className="result-grid">
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i}>
              {(row as unknown[]).map((v, j) => (
                <td key={j} className={v === null ? "null" : ""}>
                  {cell(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Problems() {
  const { state, dispatch } = useStore();
  const entries = Object.entries(state.problems).flatMap(([tabId, list]) =>
    list.map((p) => ({ tabId, ...p })),
  );
  if (entries.length === 0) return <div>0 problems — diagnostics arrive as you type.</div>;
  return (
    <div>
      {entries.map((p, i) => {
        const tab = state.tabs.find((t) => t.id === p.tabId);
        return (
          <div
            key={i}
            className="problem-row"
            onClick={() => dispatch({ type: "set-active", id: p.tabId })}
          >
            <span className={p.severity}>{p.severity === "error" ? "✕" : "⚠"}</span>
            <span>{p.message}</span>
            <span className="muted">
              {tab?.title ?? p.tabId} [{p.line}:{p.column}]
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function BottomPanel() {
  const { state, dispatch } = useStore();
  const problemCount = Object.values(state.problems).reduce((n, l) => n + l.length, 0);
  const tabs = [
    { id: "problems" as const, label: `Problems${problemCount ? ` (${problemCount})` : ""}` },
    { id: "output" as const, label: "Results" },
    { id: "terminal" as const, label: "Terminal" },
  ];

  // The PTY is owned here, not by TerminalView: hiding the panel only toggles a
  // CSS class, so the shell survives tab switches and re-shows with its state.
  const [session, setSession] = useState<TerminalSession | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const starting = useRef(false);

  useEffect(() => {
    if (!isDesktop() || state.bottomTab !== "terminal" || session || starting.current) return;
    starting.current = true;
    backend
      .terminalOpen()
      .then(setSession)
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        starting.current = false;
      });
  }, [session, state.bottomTab]);

  useEffect(() => {
    if (!session) return;
    return () => {
      void backend.terminalClose(session.id);
    };
  }, [session]);

  const onExit = useCallback(() => setSession(null), []);

  const notice = (
    <div style={{ color: "var(--muted)", fontSize: 11, paddingBottom: 2 }}>
      Runs your OS shell with your own privileges and full local access — see SECURITY.md §4a.
    </div>
  );

  const terminal = !isDesktop() ? (
    <div>The terminal needs the desktop shell — start the app with `npm run tauri dev`, or install the released build.</div>
  ) : failure ? (
    <div className="result-error" role="alert">
      Could not start a terminal: {failure}
    </div>
  ) : session ? (
    <>
      {notice}
      <TerminalView key={session.id} sessionId={session.id} onExit={onExit} />
    </>
  ) : (
    <div>Starting shell…</div>
  );

  return (
    <div className="bottom">
      <div className="bottom-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={state.bottomTab === t.id ? "active" : ""}
            onClick={() => dispatch({ type: "set-bottom-tab", tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="bottom-body" style={{ display: "flex", flexDirection: "column" }}>
        {state.bottomTab === "problems" && <Problems />}
        {state.bottomTab === "output" && <Results />}
        {state.bottomTab === "terminal" && terminal}
      </div>
    </div>
  );
}
