import { describe, expect, it } from "vitest";
import { offlineProvider } from "../src/ai/offline";

const CTX = { tables: ["public.users", "public.orders"], engine: "PostgreSQL" };

describe("offline AI", () => {
  it("generates selects, counts, and auth tables", async () => {
    expect(await offlineProvider.generateSql("show all users", CTX)).toContain("SELECT * FROM public.users;");
    expect(await offlineProvider.generateSql("count orders", CTX)).toContain("COUNT(*)");
    const ddl = await offlineProvider.generateSql("create a users table with email authentication", CTX);
    expect(ddl).toContain("CREATE TABLE users");
    expect(ddl).toContain("email VARCHAR(255) UNIQUE NOT NULL");
  });

  it("builds tables from inline column specs", async () => {
    const sql = await offlineProvider.generateSql("create table t (name text, age int)", CTX);
    expect(sql).toContain("CREATE TABLE t");
    expect(sql).toContain("age INT");
  });

  it("falls back honestly instead of hallucinating", async () => {
    const sql = await offlineProvider.generateSql("optimize my flux capacitor", CTX);
    expect(sql).toContain("could not map");
    expect(sql).toContain("public.users");
  });

  it("explains queries clause by clause", async () => {
    const out = await offlineProvider.explainSql("SELECT id FROM users WHERE id > 1 ORDER BY id LIMIT 5;", CTX);
    expect(out).toContain("Reads from");
    expect(out).toContain("Filters rows");
    expect(out).toContain("Limits to");
  });

  it("explains errors with tips", async () => {
    const out = await offlineProvider.explainError('column "username" does not exist', ["Did you mean name?"]);
    expect(out).toContain("case-sensitive");
  });
});
