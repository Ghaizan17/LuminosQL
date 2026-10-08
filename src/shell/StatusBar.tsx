import { useStore } from "../state/store";

export function StatusBar() {
  const { state } = useStore();
  return (
    <div className="status">
      <span>{state.status.connection}</span>
      <span>Query time: {state.status.queryTime}</span>
      <span className="spacer" />
      <span>{state.status.errors} errors</span>
      <span>{state.theme} theme</span>
    </div>
  );
}
