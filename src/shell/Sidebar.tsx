import { ConnectionsPanel } from "./ConnectionsPanel";
import { useStore } from "../state/store";

/** Explorer sidebar. Connections are live data (Phase 2); schema tree lands in Phase 3. */
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
            <div className="node">📁 migrations/ <em style={{ color: "var(--muted)" }}>(Phase 6)</em></div>
            <div className="node">📁 queries/</div>
            <div className="node">📄 README.md</div>
          </div>
        </>
      )}
      {state.activity !== "explorer" && (
        <div className="placeholder">
          {state.activity} panel arrives in its phase.
          <br />Shell navigation already works.
        </div>
      )}
    </div>
  );
}
