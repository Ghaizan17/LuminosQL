import { ConnectionsPanel } from "./ConnectionsPanel";
import { HistoryPanel } from "./HistoryPanel";
import { MigrationsPanel } from "./MigrationsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { WorkspaceBox } from "./WorkspaceBox";
import { useStore } from "../state/store";

/** Sidebar switches on the activity bar: explorer, migrations, history, settings. */
export function Sidebar() {
  const { state } = useStore();
  return (
    <div className="sidebar">
      {state.activity === "explorer" && (
        <>
          <h3>Databases</h3>
          <ConnectionsPanel />
          <h3>Project</h3>
          <div className="tree">
            <WorkspaceBox />
            <div className="node">📁 migrations/</div>
            <div className="node">📁 queries/</div>
            <div className="node">📄 README.md</div>
          </div>
        </>
      )}
      {state.activity === "migrations" && <MigrationsPanel />}
      {state.activity === "history" && <HistoryPanel />}
      {state.activity === "settings" && <SettingsPanel />}
      {state.activity === "search" && (
        <div className="placeholder">
          Search across schema and history arrives with workspaces.
          <br />
          Use the history panel search for now.
        </div>
      )}
    </div>
  );
}
