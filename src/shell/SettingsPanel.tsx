import { useEffect, useState } from "react";
import { backend, toFriendlyError } from "../db/backend";
import { useStore, type Settings } from "../state/store";
import { SHORTCUTS } from "../state/shortcuts";

function AiSettings({ set }: { set: (patch: Partial<Settings>) => void }) {
  const { state } = useStore();
  const [keySaved, setKeySaved] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    backend.aiKeySaved().then(setKeySaved).catch(() => setKeySaved(null));
  }, []);

  const saveKey = async () => {
    try {
      await backend.aiKeySave(key);
      setKey("");
      setKeySaved(true);
      setNote("Key saved to the OS keyring.");
    } catch (e) {
      setNote(toFriendlyError(e).title);
    }
  };

  return (
    <>
      <label>
        Provider
        <select value={state.settings.aiProvider} onChange={(e) => set({ aiProvider: e.target.value as Settings["aiProvider"] })}>
          <option value="off">Off</option>
          <option value="offline">Offline rules (no key, no network)</option>
          <option value="ollama">Ollama (local server)</option>
          <option value="openai">OpenAI-compatible API</option>
        </select>
      </label>
      {(state.settings.aiProvider === "ollama" || state.settings.aiProvider === "openai") && (
        <>
          <label>
            Base URL
            <input value={state.settings.aiBaseUrl} onChange={(e) => set({ aiBaseUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
          </label>
          <label>
            Model
            <input value={state.settings.aiModel} onChange={(e) => set({ aiModel: e.target.value })} placeholder="llama3" />
          </label>
        </>
      )}
      {state.settings.aiProvider === "openai" && (
        <>
          <label>
            API key <em className="muted">({keySaved ? "saved in keyring" : keySaved === false ? "not set" : "…"})</em>
            <input type="password" value={key} autoComplete="new-password" onChange={(e) => setKey(e.target.value)} placeholder="sk-…" />
          </label>
          <div className="row-actions">
            <button disabled={!key} onClick={saveKey}>Save key</button>
            <button disabled={!keySaved} onClick={() => backend.aiKeySave("").then(() => { setKeySaved(false); setNote("Key removed."); }).catch((e) => setNote(toFriendlyError(e).title))}>
              Remove key
            </button>
          </div>
        </>
      )}
      {note && <div className="node muted">{note}</div>}
    </>
  );
}

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
      <h3>AI provider (optional)</h3>
      <AiSettings set={set} />
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
