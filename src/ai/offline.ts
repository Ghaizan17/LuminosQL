/** Offline provider: deterministic, rule-based, no network. Handles the
 *  most common requests; anything else gets an honest template + guidance
 *  instead of a hallucinated query.
 */
import type { AiContext, AiProvider } from "./provider";

const AUTH_TEMPLATE = (table: string) => `CREATE TABLE ${table} (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`;

function parseColumns(spec: string): string | null {
  const cols = spec.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols.length === 0) return null;
  const lines: string[] = [];
  for (const col of cols) {
    const [name, ...typeParts] = col.split(/\s+/);
    if (!name || !/^[A-Za-z_]\w*$/.test(name)) return null;
    lines.push(`    ${name} ${(typeParts.join(" ") || "TEXT").toUpperCase()}`);
  }
  return lines.join(",\n");
}

export const offlineProvider: AiProvider = {
  id: "offline",
  label: "Offline rules",

  async generateSql(nl: string, ctx: AiContext): Promise<string> {
    const q = nl.trim().toLowerCase();

    let m = q.match(/create (?:a )?table (\w+)\s*\(([^)]+)\)/);
    if (m) {
      const cols = parseColumns(m[2]);
      if (cols) return `-- Generated offline from: ${nl.trim()}\nCREATE TABLE ${m[1]} (\n${cols}\n);`;
    }

    m = q.match(/creat\w*(?: a)? (\w+) table(?: with email(?: auth\w*)?)?/);
    if (m || (q.includes("users") && q.includes("email") && q.includes("creat"))) {
      const table = m?.[1] ?? "users";
      return `-- Generated offline from: ${nl.trim()}\n${AUTH_TEMPLATE(table)}`;
    }

    m = q.match(/(?:show|list|get|find|select)(?: all)? (\w+)/);
    if (m) {
      const table = bestTable(m[1], ctx);
      if (table) return `-- Generated offline from: ${nl.trim()}\nSELECT * FROM ${table};`;
    }

    m = q.match(/count(?: how many| the)? (\w+)/) ?? q.match(/how many (\w+)/);
    if (m) {
      const table = bestTable(m[1], ctx);
      if (table) return `-- Generated offline from: ${nl.trim()}\nSELECT COUNT(*) AS count FROM ${table};`;
    }

    const known = ctx.tables.length > 0 ? ctx.tables.join(", ") : "(no schema loaded — browse a connection first)";
    return `-- Offline AI could not map this request to a query.\n-- Known tables: ${known}\n-- Try: "show all <table>", "count <table>", "create table <name> (col TYPE, ...)"\nSELECT 1;`;
  },

  async explainSql(sql: string, _ctx: AiContext): Promise<string> {
    const lines = [`-- What this query does (offline explanation):`, `--`];
    const upper = sql.toUpperCase();
    const section = (name: string, re: RegExp) => {
      const hit = sql.match(re);
      if (hit) lines.push(`-- ${name}: ${hit[1].trim().split("\n")[0].slice(0, 120)}`);
    };
    if (!/\bSELECT\b/.test(upper)) {
      lines.push(`-- Not a SELECT — it modifies or defines data. Run with care (Safe Mode blocks it when on).`);
      return lines.join("\n");
    }
    section("Returns", /SELECT\s+([\s\S]*?)\s+FROM/i);
    section("Reads from", /FROM\s+([\s\S]*?)(?:\s+WHERE|\s+GROUP|\s+ORDER|\s+LIMIT|\s+HAVING|;|$)/i);
    section("Filters rows", /WHERE\s+([\s\S]*?)(?:\s+GROUP|\s+ORDER|\s+LIMIT|\s+HAVING|;|$)/i);
    section("Groups by", /GROUP BY\s+([\s\S]*?)(?:\s+HAVING|\s+ORDER|\s+LIMIT|;|$)/i);
    section("Orders by", /ORDER BY\s+([\s\S]*?)(?:\s+LIMIT|;|$)/i);
    section("Limits to", /LIMIT\s+(\d+)/i);
    if (lines.length === 2) lines.push("-- (empty query)");
    return lines.join("\n");
  },

  async explainError(title: string, causes: string[]): Promise<string> {
    const out = [`-- Why this failed:`, `-- ${title}`];
    for (const c of causes.slice(0, 4)) out.push(`-- • ${c}`);
    if (/does not exist/i.test(title)) {
      out.push(`-- Tip: browse the schema (explorer) to confirm the exact name — SQL identifiers are case-sensitive when quoted.`);
    } else if (/syntax/i.test(title)) {
      out.push(`-- Tip: run Format SQL, then check the underlined clause first.`);
    }
    return out.join("\n");
  },
};

function bestTable(mention: string, ctx: AiContext): string | null {
  const lower = mention.toLowerCase().replace(/s$/, "");
  const hit = ctx.tables.find((t) => {
    const bare = t.split(".").pop()!.toLowerCase();
    return bare === mention.toLowerCase() || bare === lower || bare === `${lower}s`;
  });
  return hit ?? null;
}
