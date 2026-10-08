import { useState } from "react";
import { backend, toFriendlyError } from "../db/backend";
import { applyPayload, buildPayload, WORKSPACE_KEY, type WorkspacePayload } from "../dx/workspace";
import { useStore } from "../state/store";

function storedDir(): string {
  try {
    return localStorage.getItem(WORKSPACE_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Project workspace: save/open `.database/config.json` (profiles sans
 *  secrets, SQL tabs, migrations dir). Secrets stay in the keyring under
 *  stable profile ids, so reopened connections just work.
 */
export function WorkspaceBox() {
  const { state, dispatch } = useStore();
  const [dir, setDir] = useState(storedDir);
  const [note, setNote] = useState<string | null>(null);

  const remember = (d: string) => {
    setDir(d);
    try {
      localStorage.setItem(WORKSPACE_KEY, d);
    } catch {
      /* private mode */
    }
  };

  const save = async () => {
    setNote(null);
    try {
      const payload: WorkspacePayload = buildPayload(state, (() => {
        try {
          return localStorage.getItem("luminosql.migrationsDir") ?? "";
        } catch {
          return "";
        }
      })());
      await backend.workspaceSave(dir.trim(), JSON.stringify(payload, null, 2));
      remember(dir.trim());
      setNote("Workspace saved.");
    } catch (e) {
      setNote(toFriendlyError(e).title);
    }
  };

  const open = async () => {
    setNote(null);
    try {
      const raw = await backend.workspaceOpen(dir.trim());
      await applyPayload(raw, dispatch);
      remember(dir.trim());
      setNote("Workspace restored — reconnect to resume.");
    } catch (e) {
      setNote(toFriendlyError(e).title);
    }
  };

  return (
    <div className="workspace-box">
      <div className="node">📁 workspace/</div>
      <input value={dir} placeholder="/home/user/my-db-project" onChange={(e) => setDir(e.target.value)} />
      <div className="row-actions">
        <button disabled={!dir.trim()} onClick={save}>Save</button>
        <button disabled={!dir.trim()} onClick={open}>Open</button>
      </div>
      {note && <div className="node muted">{note}</div>}
    </div>
  );
}
