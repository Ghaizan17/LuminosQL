import { useState } from "react";
import { backend, toFriendlyError } from "../db/backend";
import type { FriendlyError } from "../db/types";
import { useStore } from "../state/store";

export function ConnectionsPanel() {
  const { state, dispatch } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, FriendlyError>>({});

  const refresh = async () => {
    try {
      const views = await backend.listConnections();
      const osBacked = await backend.credentialStoreStatus().catch(() => null);
      dispatch({ type: "connections-loaded", views, storeOsBacked: osBacked });
    } catch {
      dispatch({ type: "connections-loaded", views: [], storeOsBacked: null });
    }
  };

  const toggle = async (id: string, live: boolean) => {
    setBusy(id);
    setErrors((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });
    try {
      if (live) {
        await backend.disconnect(id);
        dispatch({ type: "connection-dead", id });
      } else {
        const info = await backend.connect(id);
        dispatch({ type: "connection-live", id, info });
      }
    } catch (e) {
      setErrors((m) => ({ ...m, [id]: toFriendlyError(e) }));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this connection? The saved password is removed too.")) return;
    await backend.deleteConnection(id).catch(() => {});
    dispatch({ type: "connection-dead", id });
    await refresh();
  };

  return (
    <>
      <h3>
        Connections
        <button className="mini" title="New connection" onClick={() => dispatch({ type: "dialog-open", engine: "postgres" })}>
          +
        </button>
      </h3>
      <div className="store-badge" title="Where passwords are kept">
        {state.storeOsBacked === null && "browser mode — no desktop backend"}
        {state.storeOsBacked === true && "🔒 OS keyring"}
        {state.storeOsBacked === false && "⚠ session memory (no keyring — passwords forgotten on restart)"}
      </div>
      <div className="tree">
        {state.connections.length === 0 && (
          <div className="node muted">No connections yet. Press + to add one.</div>
        )}
        {state.connections.map((v) => (
          <div key={v.profile.id}>
            <div className="node conn">
              <span className={v.live ? "dot live" : "dot"} />
              <span className="conn-name" title={`${v.profile.engine} · ${v.profile.host || v.profile.database}`}>
                {v.profile.name}
              </span>
              <button
                className="mini"
                disabled={busy === v.profile.id}
                onClick={() => toggle(v.profile.id, v.live)}
                title={v.live ? "Disconnect" : "Connect"}
              >
                {busy === v.profile.id ? "…" : v.live ? "⏻" : "▶"}
              </button>
              <button className="mini danger" onClick={() => remove(v.profile.id)} title="Delete connection">
                ×
              </button>
            </div>
            {errors[v.profile.id] && (
              <div className="conn-error" role="alert">
                <strong>{errors[v.profile.id].title}</strong>
                {errors[v.profile.id].causes.map((c) => (
                  <div key={c}>• {c}</div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
