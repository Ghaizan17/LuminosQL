import { useStore } from "../state/store";
import { SHORTCUTS } from "../state/shortcuts";

export function SettingsPanel() {
  const { state, dispatch } = useStore();
  const set = (patch: Partial<typeof state.settings>) =>
    dispatch({ type: "settings-set", settings: { ...state.settings, ...patch } });

  return (
    <div className="migrations-panel">
      <h3>Settings</h3>
      <label>
        Theme
        <select
          value={state.theme}
          onChange={(e) => dispatch({ type: "set-theme", theme: e.target.value as "dark" | "light" })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <label>
        Table page size
        <select value={state.settings.pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) })}>
          {[50, 100, 500, 1000].map((n) => (
            <option key={n} value={n}>{n} rows</option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.settings.explainDiagnostics}
          onChange={(e) => set({ explainDiagnostics: e.target.checked })}
        />
        Server diagnostics (EXPLAIN on type)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={state.settings.safeMode}
          onChange={(e) => set({ safeMode: e.target.checked })}
        />
        Safe mode — block destructive statements instead of asking
      </label>
      <h3>Keyboard shortcuts</h3>
      <div className="tree">
        {Object.entries(SHORTCUTS).map(([keys, action]) => (
          <div className="node" key={keys}>
            <span className="conn-name">{action}</span>
            <em className="muted">{keys}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
