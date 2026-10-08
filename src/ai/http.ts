/** HTTP provider for OpenAI-compatible APIs and Ollama. The API key (when
 *  needed) lives in the OS keyring — never in settings, logs, or disk.
 */
import { backend } from "../db/backend";
import type { AiContext, AiProvider } from "./provider";
import { AiUnavailable } from "./provider";

export interface HttpConfig {
  baseUrl: string;
  model: string;
  needsKey: boolean;
}

async function chat(config: HttpConfig, system: string, user: string): Promise<string> {
  let headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.needsKey) {
    const key = await backend.aiKeyGet().catch(() => null);
    if (!key) throw new AiUnavailable("No API key saved — add one in Settings → AI.");
    headers = { ...headers, Authorization: `Bearer ${key}` };
  }
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: config.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0 }),
    });
  } catch {
    throw new AiUnavailable(`Cannot reach ${config.baseUrl} — is the server running?`);
  }
  if (!res.ok) throw new AiUnavailable(`AI server returned ${res.status} — check the model name and key.`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new AiUnavailable("AI server returned an empty answer.");
  return content;
}

function schemaBlock(ctx: AiContext): string {
  return `Engine: ${ctx.engine}. Tables: ${ctx.tables.slice(0, 60).join(", ") || "(unknown)"}.`;
}

export function httpProvider(id: string, label: string, config: HttpConfig): AiProvider {
  return {
    id,
    label,
    async generateSql(nl: string, ctx: AiContext): Promise<string> {
      return chat(config, `You write SQL. ${schemaBlock(ctx)} Answer with the SQL statement only, no prose.`, nl);
    },
    async explainSql(sql: string, ctx: AiContext): Promise<string> {
      return chat(config, `You explain SQL briefly. ${schemaBlock(ctx)} Prefix every line with "-- ".`, `Explain: ${sql}`);
    },
    async explainError(title: string, causes: string[]): Promise<string> {
      return chat(config, `You explain database errors briefly. Prefix every line with "-- ".`, `${title}. ${causes.join(" ")}`);
    },
  };
}
