import { useEffect, useState } from "react";
import { httpProvider } from "../ai/http";
import { offlineProvider } from "../ai/offline";
import type { AiContext, AiProvider } from "../ai/provider";
import { useStore } from "../state/store";

export function resolveProvider(
  kind: string,
  settings: { aiBaseUrl: string; aiModel: string },
): AiProvider | null {
  if (kind === "offline") return offlineProvider;
  if (kind === "ollama") {
    return httpProvider("ollama", "Ollama", { baseUrl: settings.aiBaseUrl, model: settings.aiModel, needsKey: false });
  }
  if (kind === "openai") {
    return httpProvider("openai", "OpenAI-compatible", { baseUrl: settings.aiBaseUrl, model: settings.aiModel, needsKey: true });
  }
  return null;
}

type Mode = "generate" | "explain" | "error";

export function AiAssistant() {
  const { state, dispatch } = useStore();
  const [mode, setMode] = useState<Mode | null>(null);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const open = (m: Mode) => () => {
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
      setInput(m === "generate" ? "" : tab?.content ?? "");
      setOutput(null);
      setError(null);
      setMode(m);
    };
    const gen = open("generate");
    const exp = open("explain");
    const err = open("error");
    window.addEventListener("luminos:ai-generate", gen);
    window.addEventListener("luminos:ai-explain", exp);
    window.addEventListener("luminos:ai-error", err);
    return () => {
      window.removeEventListener("luminos:ai-generate", gen);
      window.removeEventListener("luminos:ai-explain", exp);
      window.removeEventListener("luminos:ai-error", err);
    };
  }, [state.tabs, state.activeTabId]);

  if (!mode) return null;

  const provider = resolveProvider(state.settings.aiProvider, state.settings);
  const ctx: AiContext = {
    tables: Object.values(state.explorer).flatMap((c) =>
      c.items.filter((n) => (n.kind === "table" || n.kind === "view") && n.schema && n.table).map((n) => `${n.schema}.${n.table}`),
    ),
    engine: state.connections.find((c) => c.profile.id === state.activeConnectionId)?.profile.engine ?? "postgres",
  };

  const run = async () => {
    if (!provider) {
      setError("AI is off — pick a provider in Settings → AI (Offline rules needs no key).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "generate") setOutput(await provider.generateSql(input, ctx));
      else if (mode === "explain") setOutput(await provider.explainSql(input, ctx));
      else {
        const tab = state.tabs.find((t) => t.id === state.activeTabId);
        const result = tab ? state.results[tab.id] : undefined;
        const err = result?.error;
        setOutput(await provider.explainError(err?.title ?? "No error on this tab.", err?.causes ?? []));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const insert = () => {
    if (!output) return;
    dispatch({
      type: "open-tab",
      tab: { id: `ai-${Date.now()}`, title: "ai.sql", content: `${output}\n`, kind: "sql" },
    });
    setMode(null);
  };

  const titles: Record<Mode, string> = {
    generate: "Generate SQL from description",
    explain: "Explain this query",
    error: "Explain the last error",
  };

  return (
    <div className="palette-backdrop" onClick={() => setMode(null)}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titles[mode]}>
        <h2>✨ {titles[mode]} <em className="muted">({provider?.label ?? "off"})</em></h2>
        {mode !== "error" && (
          <label>
            {mode === "generate" ? "Describe what you want" : "SQL"}
            <textarea
              rows={mode === "generate" ? 3 : 8}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === "generate" ? "show all users with more than 5 orders" : "SELECT …"}
            />
          </label>
        )}
        {output && <pre className="sql-preview">{output}</pre>}
        {error && (
          <div className="form-error" role="alert">
            <strong>{error}</strong>
          </div>
        )}
        <div className="dialog-actions">
          <button onClick={() => setMode(null)}>Close</button>
          {output && mode === "generate" && (
            <button onClick={insert}>Open in editor</button>
          )}
          <button className="primary" onClick={run} disabled={busy || (mode !== "error" && !input.trim())}>
            {busy ? "Thinking…" : "Ask"}
          </button>
        </div>
      </div>
    </div>
  );
}
