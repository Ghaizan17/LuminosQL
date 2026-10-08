import { useStore } from "../state/store";

export function StatusBar() {
  const { state, dispatch } = useStore();
  const problems = Object.values(state.problems).reduce((n, l) => n + l.length, 0);
  return (
    <div className="status">
      <span>{state.status.connection}</span>
      <span>Query time: {state.status.queryTime}</span>
      <span className="spacer" />
      <span
        className="status-problems"
        title="Open Problems"
        onClick={() => dispatch({ type: "set-bottom-tab", tab: "problems" })}
      >
        {problems === 0 ? "0 problems" : `✕ ${problems} problem${problems === 1 ? "" : "s"}`}
      </span>
      <span>{state.theme} theme</span>
    </div>
  );
}
