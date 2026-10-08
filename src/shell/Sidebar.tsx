import { ConnectionsPanel } from "./ConnectionsPanel";
import { MigrationsPanel } from "./MigrationsPanel";
import { useStore } from "../state/store";

/** Explorer sidebar: live connections + schema tree; migrations panel on its activity. */
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
            <div className="node">📁 migrations/</div>
            <div className="node">📁 queries/</div>
            <div className="node">📄 README.md</div>
          </div>
        </>
      )}
      {state.activity === "migrations" && <MigrationsPanel />}
      {state.activity !== "explorer" && state.activity !== "migrations" && (
        <div className="placeholder">
          {state.activity} panel arrives in its phase.
          <br />Shell navigation already works.
        </div>
      )}
    </div>
  );
}
