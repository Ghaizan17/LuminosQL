/** Persisted UI settings (theme lives separately; see store). */
import type { Settings } from "../state/store";

const KEY = "luminosql.settings";

const DEFAULTS: Settings = {
  pageSize: 50,
  explainDiagnostics: true,
  safeMode: false,
  aiProvider: "off",
  aiBaseUrl: "http://localhost:11434/v1",
  aiModel: "llama3",
};

export function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      pageSize: [50, 100, 500, 1000].includes(parsed.pageSize ?? 0) ? parsed.pageSize! : 50,
      explainDiagnostics: parsed.explainDiagnostics ?? true,
      safeMode: parsed.safeMode ?? false,
      aiProvider: ["off", "offline", "ollama", "openai"].includes(parsed.aiProvider ?? "") ? parsed.aiProvider! : "off",
      aiBaseUrl: parsed.aiBaseUrl || DEFAULTS.aiBaseUrl,
      aiModel: parsed.aiModel || DEFAULTS.aiModel,
    };
  } catch {
    return DEFAULTS;
  }
}

export function save(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}
