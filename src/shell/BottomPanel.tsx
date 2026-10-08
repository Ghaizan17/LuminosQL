import { useStore } from "../state/store";

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
      <div className="bottom-body">
        {state.bottomTab === "problems" && <Problems />}
        {state.bottomTab === "output" && <Results />}
        {state.bottomTab === "terminal" && <div>$ integrated terminal arrives in Phase 8.</div>}
      </div>
    </div>
  );
}
