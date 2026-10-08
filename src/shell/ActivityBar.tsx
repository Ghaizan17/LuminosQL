import { useStore, type ActivityView } from "../state/store";

const ITEMS: { id: ActivityView; icon: string; label: string }[] = [
  { id: "explorer", icon: "🗂", label: "Explorer" },
  { id: "search", icon: "🔍", label: "Search" },
  { id: "migrations", icon: "📦", label: "Migrations" },
  { id: "history", icon: "🕘", label: "Query History" },
  { id: "settings", icon: "⚙", label: "Settings" },
];

export function ActivityBar() {
  const { state, dispatch } = useStore();
  return (
    <div className="activity" role="navigation" aria-label="Activity bar">
      {ITEMS.map((it) => (
        <button
          key={it.id}
          title={it.label}
          className={state.activity === it.id ? "active" : ""}
          onClick={() => dispatch({ type: "set-activity", activity: it.id })}
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
}
