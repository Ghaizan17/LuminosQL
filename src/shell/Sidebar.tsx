import { useStore } from "../state/store";

/** Phase 1 placeholder tree. Phases 2–3 replace nodes with live schema data. */
export function Sidebar() {
  const { state } = useStore();
  return (
    <div className="sidebar">
      {state.activity === "explorer" && (
        <>
          <h3>Databases</h3>
          <div className="tree">
            <div className="node">▾ Local PostgreSQL <em style={{ color: "var(--muted)" }}>(Phase 2)</em></div>
            <div className="node" style={{ paddingLeft: 20 }}>▸ postgres</div>
            <div className="node" style={{ paddingLeft: 20 }}>▸ myapp_dev</div>
          </div>
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
