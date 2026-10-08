import { useStore } from "../state/store";

export function BottomPanel() {
  const { state, dispatch } = useStore();
  const tabs = [
    { id: "problems" as const, label: "Problems" },
    { id: "output" as const, label: "Output" },
    { id: "terminal" as const, label: "Terminal" },
  ];
  return (
    <div className="bottom">
      <div className="bottom-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={state.bottomTab === t.id ? "active" : ""}
            onClick={() => dispatch({ type: "set-bottom-tab", tab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="bottom-body">
        {state.bottomTab === "problems" && <div>0 problems — diagnostics arrive in Phase 4.</div>}
        {state.bottomTab === "output" && <div>LuminosQL Phase 1 shell ready. Query execution arrives in Phase 4.</div>}
        {state.bottomTab === "terminal" && <div>$ integrated terminal arrives in Phase 8.</div>}
      </div>
    </div>
  );
}
