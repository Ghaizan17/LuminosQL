import { useCallback, useEffect, useState } from "react";
import { backend, toFriendlyError } from "../db/backend";
import type { FriendlyError, MigrationState } from "../db/types";
import { useStore } from "../state/store";

function dirStored(): string {
  try {
    return localStorage.getItem("luminosql.migrationsDir") ?? "";
  } catch {
    return "";
  }
}

export function MigrationsPanel() {
  const { state, dispatch } = useStore();
  const [dir, setDir] = useState(dirStored);
  const [connId, setConnId] = useState(state.activeConnectionId ?? "");
  const [status, setStatus] = useState<MigrationState[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [newName, setNewName] = useState("");

  const live = state.connections.filter((c) => c.live);
  const active = connId || state.activeConnectionId || "";

  const refresh = useCallback(async () => {
    if (!active || !dir.trim()) {
      setStatus(null);
      return;
    }
    setError(null);
    try {
      setStatus(await backend.migrationStatus(active, dir.trim()));
    } catch (e) {
      setError(toFriendlyError(e));
      setStatus(null);
    }
  }, [active, dir]);

  useEffect(() => {
    try {
      localStorage.setItem("luminosql.migrationsDir", dir);
    } catch {
      /* private mode */
    }
  }, [dir]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const afterChange = async () => {
    await refresh();
    if (active) dispatch({ type: "tree-drop", match: `:${active}` });
  };

  const run = async (version: string, fn: (id: string, d: string, v: string) => Promise<void>) => {
    setBusy(version);
    setError(null);
    try {
      await fn(active, dir.trim(), version);
      await afterChange();
    } catch (e) {
      setError(toFriendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  const pending = (status ?? []).filter((s) => !s.applied);
  const applied = (status ?? []).filter((s) => s.applied);
  const lastApplied = [...applied].reverse()[0];

  return (
    <div className="migrations-panel">
      <h3>Migrations</h3>
      <label>
        Connection
        <select value={active} onChange={(e) => setConnId(e.target.value)}>
          <option value="">select…</option>
          {live.map((c) => (
            <option key={c.profile.id} value={c.profile.id}>{c.profile.name}</option>
          ))}
        </select>
      </label>
      <label>
        Directory
        <input value={dir} placeholder="/home/user/project/migrations" onChange={(e) => setDir(e.target.value)} />
      </label>
      <div className="row-actions">
        <button onClick={() => void refresh()} disabled={!active || !dir.trim()}>Refresh</button>
        <button
          disabled={pending.length === 0 || busy !== null}
          onClick={() => pending.reduce((p, s) => p.then(() => run(s.version, (a, d, v) => backend.migrateUp(a, d, v))), Promise.resolve())}
        >
          Run all pending ({pending.length})
        </button>
        <button
          disabled={!lastApplied || busy !== null}
          title="Roll back the most recent migration"
          onClick={() => lastApplied && void run(lastApplied.version, (a, d, v) => backend.migrateDown(a, d, v))}
        >
          Rollback {lastApplied ? lastApplied.version : ""}
        </button>
      </div>
      {error && (
        <div className="form-error" role="alert">
          <strong>{error.title}</strong>
          {error.causes.map((c) => (
            <div key={c}>• {c}</div>
          ))}
        </div>
      )}
      <div className="tree">
        {(status ?? []).map((s) => (
          <div className="node migration" key={s.version}>
            <span>{s.applied ? "✓" : "○"}</span>
            <span className="conn-name">
              {s.version}_{s.name}
              {!s.checksum_ok && <em className="warn"> — changed since apply!</em>}
            </span>
            {!s.applied && (
              <button className="mini" disabled={busy !== null} onClick={() => void run(s.version, (a, d, v) => backend.migrateUp(a, d, v))}>
                {busy === s.version ? "…" : "Run"}
              </button>
            )}
          </div>
        ))}
        {status && status.length === 0 && <div className="node muted">No versioned .sql files found.</div>}
        {!status && <div className="node muted">Pick a connection + directory to list migrations.</div>}
      </div>
      <h3>New migration</h3>
      <div className="row-actions">
        <input value={newName} placeholder="create_orders" onChange={(e) => setNewName(e.target.value)} />
        <button
          disabled={!newName.trim() || !dir.trim()}
          onClick={() => {
            setError(null);
            backend
              .createMigration(dir.trim(), newName.trim())
              .then(() => {
                setNewName("");
                return refresh();
              })
              .catch((e) => setError(toFriendlyError(e)));
          }}
        >
          Create
        </button>
      </div>
    </div>
  );
}
