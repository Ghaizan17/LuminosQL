import { useStore } from "../state/store";

function Pane({ tabId }: { tabId: string }) {
  const { state, dispatch } = useStore();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return <div className="placeholder">No file open. Ctrl+P → New SQL Query.</div>;
  return (
    <textarea
      value={tab.content}
      spellCheck={false}
      aria-label={tab.title}
      onChange={(e) => dispatch({ type: "edit-tab", id: tab.id, content: e.target.value })}
    />
  );
}

export function EditorArea() {
  const { state, dispatch } = useStore();
  return (
    <div className="editor">
      <div className="tabs" role="tablist">
        {state.tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === state.activeTabId}
            className={t.id === state.activeTabId ? "tab active" : "tab"}
            onClick={() => dispatch({ type: "set-active", id: t.id })}
          >
            {t.title}
            <button
              className="close"
              title="Close"
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "close-tab", id: t.id });
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="split">
        <div className="pane">
          {state.activeTabId ? <Pane tabId={state.activeTabId} /> : <div className="placeholder">No file open.</div>}
        </div>
        {state.splitTabId && (
          <div className="pane">
            <Pane tabId={state.splitTabId} />
          </div>
        )}
      </div>
    </div>
  );
}
