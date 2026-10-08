import { useState } from "react";
import { backend, toFriendlyError } from "../db/backend";
import { blankProfile, type Engine, type FriendlyError } from "../db/types";
import { useStore } from "../state/store";

const ENGINES: Engine[] = ["postgres", "mysql", "sqlite"];

export function ConnectionDialog() {
  const { state, dispatch } = useStore();
  const [engine, setEngine] = useState<Engine>(state.connDialog?.engine ?? "postgres");
  const [form, setForm] = useState(() => blankProfile(state.connDialog?.engine ?? "postgres"));
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  if (!state.connDialog) return null;

  const set = (k: keyof typeof form, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const switchEngine = (e: Engine) => {
    setEngine(e);
    setForm((f) => ({ ...blankProfile(e), name: f.name }));
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await backend.createConnection({ ...form, engine }, password);
      const views = await backend.listConnections();
      const osBacked = await backend.credentialStoreStatus().catch(() => null);
      dispatch({ type: "connections-loaded", views, storeOsBacked: osBacked });
      dispatch({ type: "dialog-close" });
    } catch (e) {
      const fe = toFriendlyError(e);
      // create_connection rejects with Vec<String> validation errors.
      setError(
        Array.isArray(e) ? { title: "Check the highlighted fields.", causes: e as string[], code: "validation" } : fe,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="palette-backdrop" onClick={() => dispatch({ type: "dialog-close" })}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New connection">
        <h2>New Connection</h2>
        <div className="engine-tabs">
          {ENGINES.map((e) => (
            <button key={e} className={engine === e ? "active" : ""} onClick={() => switchEngine(e)}>
              {e === "postgres" ? "PostgreSQL" : e === "mysql" ? "MySQL" : "SQLite"}
            </button>
          ))}
        </div>
        <label>
          Name
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Local PostgreSQL" />
        </label>
        {engine !== "sqlite" && (
          <>
            <div className="row">
              <label>
                Host
                <input value={form.host} onChange={(e) => set("host", e.target.value)} />
              </label>
              <label className="narrow">
                Port
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => set("port", Number(e.target.value))}
                />
              </label>
            </div>
            <label>
              Database
              <input value={form.database} onChange={(e) => set("database", e.target.value)} />
            </label>
            <div className="row">
              <label>
                Username
                <input value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="username" />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </div>
            {engine === "postgres" && (
              <label className="check">
                <input type="checkbox" checked={form.ssl} onChange={(e) => set("ssl", e.target.checked)} />
                Require SSL
              </label>
            )}
          </>
        )}
        {engine === "sqlite" && (
          <label>
            File path <span className="hint">(`:memory:` for ephemeral)</span>
            <input
              value={form.database}
              onChange={(e) => set("database", e.target.value)}
              placeholder="/home/user/data/app.sqlite"
            />
          </label>
        )}
        {error && (
          <div className="form-error" role="alert">
            <strong>{error.title}</strong>
            {error.causes.length > 0 && (
              <ul>
                {error.causes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="dialog-actions">
          <button onClick={() => dispatch({ type: "dialog-close" })}>Cancel</button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Connection"}
          </button>
        </div>
        <p className="hint">Passwords go to the OS keyring, never to disk or logs.</p>
      </div>
    </div>
  );
}
