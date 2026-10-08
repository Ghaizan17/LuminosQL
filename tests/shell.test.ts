import { describe, expect, it } from "vitest";
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
