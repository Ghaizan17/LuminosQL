import { describe, expect, it } from "vitest";
import { toFriendlyError } from "../src/db/backend";
import { buildCreateTable, buildDropTable, buildRenameTable, buildSelectAll } from "../src/db/sqlBuilder";
import { blankProfile } from "../src/db/types";
import { COMMANDS, filterCommands } from "../src/state/commands";
import { keywordProvider } from "../src/sql/completion";
import { reducer } from "../src/state/store";

const base: ShellState = {
  theme: "dark",
  activity: "explorer",
  sidebarVisible: true,
  bottomVisible: true,
  bottomTab: "output",
  tabs: [],
  activeTabId: null,
  splitTabId: null,
  paletteOpen: false,
  status: { connection: "x", queryTime: "—", errors: 0 },
  connections: [],
  activeConnectionId: null,
  lastServerInfo: null,
  connDialog: null,
  storeOsBacked: null,
  explorer: {},
  expanded: {},
  defs: {},
  problems: {},
  results: {},
};

describe("command palette", () => {
  it("returns all commands on empty query", () => {
    expect(filterCommands("")).toHaveLength(COMMANDS.length);
  });
  it("matches case-insensitively and strips leading >", () => {
    const hits = filterCommands("> theme");
    expect(hits.some((c) => c.id === "theme")).toBe(true);
  });
  it("every command declares its phase", () => {
    for (const c of COMMANDS) expect(c.phase).toMatch(/^\d+$/);
  });
});

describe("keyword completer", () => {
  it("suggests SELECT for prefix SEL", () => {
    expect(keywordProvider.complete("SEL").map((c) => c.label)).toContain("SELECT");
  });
  it("empty prefix lists all keywords", () => {
    expect(keywordProvider.complete("").length).toBeGreaterThan(20);
  });
});

describe("shell reducer", () => {
  it("toggles split on/off around the active tab", () => {
    const s1 = reducer({ ...base, activeTabId: "a" }, { type: "toggle-split" });
    expect(s1.splitTabId).toBe("a");
    expect(reducer(s1, { type: "toggle-split" }).splitTabId).toBeNull();
  });
  it("closing the active tab activates its neighbour", () => {
    const s: ShellState = {
      ...base,
      tabs: [{ id: "a", title: "a.sql", content: "", kind: "sql" }, { id: "b", title: "b.sql", content: "", kind: "sql" }],
      activeTabId: "b",
    };
    const next = reducer(s, { type: "close-tab", id: "b" });
    expect(next.activeTabId).toBe("a");
  });
});

describe("connection state", () => {
  const view = (id: string, live: boolean) => ({
    profile: { ...blankProfile("postgres"), id, name: id },
    live,
  });

  it("going live updates status bar and clears on disconnect", () => {
    const loaded = reducer(
      base,
      { type: "connections-loaded", views: [view("a", false)], storeOsBacked: true },
    );
    const live = reducer(
      loaded,
      { type: "connection-live", id: "a", info: { engine: "PostgreSQL", version: "18.6", latency_ms: 3 } },
    );
    expect(live.activeConnectionId).toBe("a");
    expect(live.status.connection).toContain("a");
    expect(live.status.connection).toContain("18.6");
    const dead = reducer(live, { type: "connection-dead", id: "a" });
    expect(dead.activeConnectionId).toBeNull();
    expect(dead.status.connection).toBe("Not connected");
  });

  it("reloading drops a stale active connection", () => {
    const s = reducer(
      { ...base, activeConnectionId: "gone" },
      { type: "connections-loaded", views: [view("b", true)], storeOsBacked: false },
    );
    expect(s.activeConnectionId).toBeNull();
    expect(s.storeOsBacked).toBe(false);
  });

  it("blank profiles carry engine defaults", () => {
    expect(blankProfile("postgres").port).toBe(5432);
    expect(blankProfile("mysql").port).toBe(3306);
    expect(blankProfile("sqlite").host).toBe("");
  });

  it("backend errors normalize to friendly shape", () => {
    expect(toFriendlyError(new Error("nope")).title).toContain("nope");
    expect(toFriendlyError('{"title":"X","causes":[],"code":"c"}').code).toBe("c");
  });
});

describe("explorer tree cache", () => {
  const node = (key: string) => ({ key, label: key, kind: "schema" as const, connId: "c1", schema: "public" });

  it("toggle / ready / drop-subtree round-trips", () => {
    let s = reducer(base, { type: "tree-toggle", key: "conn:c1" });
    expect(s.expanded["conn:c1"]).toBe(true);
    s = reducer(s, { type: "tree-ready", key: "conn:c1", items: [node("schema:c1:public")] });
    s = reducer(s, { type: "tree-ready", key: "schema:c1:public", items: [node("group-tables:c1:public")] });
    s = reducer(s, { type: "tree-drop", match: ":c1:public" });
    expect(s.explorer["schema:c1:public"]).toBeUndefined();
    expect(s.explorer["group-tables:c1:public"]).toBeUndefined();
    expect(s.explorer["conn:c1"]).toBeDefined();
  });

  it("loading then failure surfaces the friendly error", () => {
    let s = reducer(base, { type: "tree-loading", key: "k" });
    expect(s.explorer["k"].status).toBe("loading");
    s = reducer(s, { type: "tree-failed", key: "k", error: { title: "X", causes: ["Y"], code: "c" } });
    expect(s.explorer["k"].error?.causes).toEqual(["Y"]);
  });
});

describe("sql builders", () => {
  it("create table quotes per dialect and inlines single PK", () => {
    const sql = buildCreateTable("postgres", "public", "users", [
      { name: "id", dataType: "BIGINT", nullable: false, primaryKey: true, defaultValue: "" },
      { name: "email", dataType: "TEXT", nullable: false, primaryKey: false, defaultValue: "" },
    ]);
    expect(sql).toContain('CREATE TABLE "public"."users"');
    expect(sql).toContain('"id" BIGINT PRIMARY KEY');
    expect(buildCreateTable("mysql", "app", "t", [])).toContain("CREATE TABLE `app`.`t`");
    expect(buildCreateTable("sqlite", "main", "t", [])).toContain('CREATE TABLE "t"');
    expect(buildRenameTable("postgres", "public", "a", "b")).toBe('ALTER TABLE "public"."a" RENAME TO "b";');
    expect(buildDropTable("sqlite", "main", "t")).toBe('DROP TABLE "t";');
    expect(buildSelectAll("mysql", "app", "t")).toBe("SELECT * FROM `app`.`t`;");
  });
});
