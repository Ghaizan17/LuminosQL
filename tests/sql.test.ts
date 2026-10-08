import { describe, expect, it } from "vitest";
import { findUnknownTables, parseTableRefs, resolveAlias } from "../src/sql/aliases";
import { formatSql } from "../src/sql/format";
import { suggestFor, type SchemaSnapshot } from "../src/sql/suggest";

describe("table refs", () => {
  it("extracts tables with explicit, implicit, and missing aliases", () => {
    const refs = parseTableRefs("SELECT u.id FROM users u JOIN orders AS o ON o.user_id = u.id");
    expect(refs).toEqual([
      { schema: undefined, table: "users", alias: "u" },
      { schema: undefined, table: "orders", alias: "o" },
    ]);
  });

  it("keeps schema qualification and ignores clause keywords as aliases", () => {
    const refs = parseTableRefs("SELECT * FROM public.users WHERE id = 1");
    expect(refs).toEqual([{ schema: "public", table: "users", alias: "users" }]);
  });

  it("resolves aliases case-insensitively", () => {
    const refs = parseTableRefs("select * from Users U");
    expect(resolveAlias(refs, "u")?.table).toBe("Users");
    expect(resolveAlias(refs, "missing")).toBeUndefined();
  });

  it("locates unknown tables with offsets", () => {
    const sql = "SELECT * FROM users JOIN ghosts ON true";
    const known = new Set(["public.users", "users"]);
    const found = findUnknownTables(sql, known);
    expect(found.map((f) => f.name)).toEqual(["ghosts"]);
    expect(sql.slice(found[0].offset, found[0].offset + 6)).toBe("ghosts");
  });
});

describe("formatter", () => {
  it("uppercases keywords and splits clauses", () => {
    expect(formatSql("select id, name from users where id = 1;")).toBe(
      "SELECT id,\nname\nFROM users\nWHERE id = 1;\n",
    );
  });

  it("keeps multi-word joins on one line", () => {
    const out = formatSql("select * from users u left join orders o on o.user_id = u.id");
    expect(out).toContain("\nLEFT JOIN orders o ON o.user_id = u.id");
  });

  it("is idempotent and preserves string literals", () => {
    const once = formatSql("select * from users where name = 'O''Brien and sons';");
    expect(formatSql(once)).toBe(once);
    expect(once).toContain("'O''Brien and sons'");
  });
});

const SNAP: SchemaSnapshot = {
  defaultSchema: "public",
  tables: [
    { schema: "public", name: "users" },
    { schema: "public", name: "orders" },
  ],
  columnsByTable: {
    "public.users": [
      { name: "id", data_type: "bigint", nullable: false, default: null, pk_position: 1 },
      { name: "email", data_type: "text", nullable: false, default: null, pk_position: null },
    ],
    "public.orders": [{ name: "total", data_type: "numeric", nullable: true, default: null, pk_position: null }],
  },
};

describe("suggest", () => {
  it("completes columns after an alias prefix", () => {
    const sql = "SELECT u. FROM users u";
    const got = suggestFor(sql, sql.indexOf("u.") + 2, SNAP).map((s) => s.label);
    expect(got).toEqual(["id", "email"]);
  });

  it("filters columns by typed prefix", () => {
    const sql = "SELECT u.em FROM users u";
    const at = sql.indexOf("u.em") + 4;
    expect(suggestFor(sql, at, SNAP).map((s) => s.label)).toEqual(["email"]);
  });

  it("suggests tables inside FROM", () => {
    const sql = "SELECT * FROM us";
    expect(suggestFor(sql, sql.length, SNAP).map((s) => s.label)).toContain("users");
  });

  it("falls back to keywords in open context", () => {
    const sql = "SEL";
    expect(suggestFor(sql, sql.length, SNAP).map((s) => s.label)).toContain("SELECT");
  });
});
