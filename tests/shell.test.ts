import { describe, expect, it } from "vitest";
import { toFriendlyError } from "../src/db/backend";
import { blankProfile } from "../src/db/types";
import { COMMANDS, filterCommands } from "../src/state/commands";
import { keywordProvider } from "../src/sql/completion";
import { reducer } from "../src/state/store";
import type { ShellState } from "../src/state/store";

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
      tabs: [{ id: "a", title: "a.sql", content: "" }, { id: "b", title: "b.sql", content: "" }],
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
