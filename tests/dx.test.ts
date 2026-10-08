import { describe, expect, it } from "vitest";
import { parseCsv, toCsvRow } from "../src/dx/csv";
import { record, search, toggleFavorite } from "../src/dx/history";
import { redactSecrets } from "../src/dx/logger";
import { buildPayload } from "../src/dx/workspace";
import { snippetsFor } from "../src/sql/snippets";
import { buildInsertInto, sqlLiteral } from "../src/db/sqlBuilder";

describe("history", () => {
  it("prepends, caps, and searches", () => {
    let log = record([], { sql: "SELECT 1", connection: "pg", elapsedMs: 3, ok: true });
    log = record(log, { sql: "DROP TABLE t", connection: "pg", elapsedMs: 1, ok: false });
    expect(log).toHaveLength(2);
    expect(search(log, "drop")).toHaveLength(1);
    expect(search(log, "pg")).toHaveLength(2);
    expect(toggleFavorite(log, log[0].id)[0].favorite).toBe(true);
  });
});

describe("csv", () => {
  it("round-trips quotes, commas, and newlines", () => {
    const rows = [["a", "b,c", 'q"q'], ["multi\nline", "", "x"]];
    const text = rows.map(toCsvRow).join("\n");
    expect(parseCsv(text)).toEqual(rows);
  });

  it("requires no trailing newline and skips phantom rows", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });
});

describe("insert builder", () => {
  it("renders literals per dialect", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(42)).toBe("42");
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    const sql = buildInsertInto("postgres", "public", "t", ["a", "b"], [[1, null]]);
    expect(sql).toBe('INSERT INTO "public"."t" ("a", "b") VALUES\n(1, NULL);');
  });
});

describe("snippets", () => {
  it("matches triggers by prefix only", () => {
    expect(snippetsFor("se").map((s) => s.trigger)).toEqual(["sel"]);
    expect(snippetsFor("")).toEqual([]);
    expect(snippetsFor("xyz")).toEqual([]);
  });
});

describe("workspace payload", () => {
  it("carries profiles and sql tabs without secrets", () => {
    const state = {
      connections: [{ profile: { id: "c1", name: "pg", engine: "postgres", host: "h", port: 5432, database: "d", username: "u", ssl: false }, live: true }],
      tabs: [
        { id: "a", title: "q.sql", content: "SELECT 1", kind: "sql" },
        { id: "b", title: "t (data)", content: "", kind: "data", dataRef: { connId: "c1", schema: "public", table: "t" } },
      ],
    } as unknown as ShellState;
    const payload = buildPayload(state, "/tmp/mig");
    expect(payload.connections).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("password");
    expect(payload.tabs).toEqual([{ title: "q.sql", content: "SELECT 1" }]);
  });
});

describe("logger", () => {
  it("redacts passwords, urls, and bearer tokens", () => {
    expect(redactSecrets("password=hunter2 ok")).toBe("[redacted] ok");
    expect(redactSecrets("postgres://admin:hunter2@host/db")).toContain("***:***@");
    expect(redactSecrets("Bearer abc123XYZ ok")).toContain("[redacted]");
    expect(redactSecrets("SELECT 1")).toBe("SELECT 1");
  });
});
