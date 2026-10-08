import { useState } from "react";
import { search } from "../dx/history";
import { useStore } from "../state/store";

export function HistoryPanel() {
  const { state, dispatch } = useStore();
  const [q, setQ] = useState("");
  const [onlyFav, setOnlyFav] = useState(false);
  const entries = search(state.history, q).filter((e) => !onlyFav || e.favorite);

  const reopen = (sql: string) => {
    dispatch({
      type: "open-tab",
      tab: { id: `q-${Date.now()}`, title: "query.sql", content: sql, kind: "sql" },
    });
  };

  return (
    <div className="migrations-panel">
      <h3>Query History</h3>
      <label>
        Search
        <input value={q} placeholder="sql or connection…" onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="row-actions">
        <label className="check">
          <input type="checkbox" checked={onlyFav} onChange={(e) => setOnlyFav(e.target.checked)} /> ★ favorites
        </label>
        <button onClick={() => dispatch({ type: "history-clear" })} disabled={state.history.length === 0}>
          Clear all
        </button>
      </div>
      <div className="tree">
        {entries.length === 0 && <div className="node muted">No queries yet — run one with Ctrl+Enter.</div>}
        {entries.slice(0, 100).map((e) => (
          <div className="node history" key={e.id} title={e.sql}>
            <span>{e.ok ? "✓" : "✕"}</span>
            <button className="mini" title={e.favorite ? "Unfavorite" : "Favorite"} onClick={() => dispatch({ type: "history-fav", id: e.id })}>
              {e.favorite ? "★" : "☆"}
            </button>
            <span className="conn-name">
              {e.sql.split("\n")[0].slice(0, 42)}
              <br />
              <em className="muted">{e.connection} · {e.elapsedMs} ms</em>
            </span>
            <button className="mini" title="Reopen in editor" onClick={() => reopen(e.sql)}>↗</button>
            <button className="mini danger" title="Delete" onClick={() => dispatch({ type: "history-remove", id: e.id })}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
