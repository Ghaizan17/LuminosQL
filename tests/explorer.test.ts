import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadChildren } from "../src/shell/ExplorerTree";
import { reducer } from "../src/state/store";
import type { Action, ShellState, TreeNode } from "../src/state/store";

const DEF = {
  schema: "public",
  name: "orders",
  kind: "table" as const,
  columns: [
    { name: "id", data_type: "bigint", nullable: false, default: null, pk_position: 1 },
    { name: "total", data_type: "numeric", nullable: true, default: "0", pk_position: null },
  ],
  indexes: [{ name: "orders_total_idx", columns: ["total"], unique: false, primary: false }],
  foreign_keys: [
    { name: "orders_user_fk", columns: ["user_id"], ref_schema: "public", ref_table: "users", ref_columns: ["id"] },
  ],
};

const RESPONSES: Record<string, unknown> = {
  list_schemas: [{ name: "public" }],
  list_tables: [
    { schema: "public", name: "orders", kind: "table" },
    { schema: "public", name: "big_orders", kind: "view" },
  ],
  describe_table: DEF,
  list_functions: [{ schema: "public", name: "total_sales", arguments: "", return_type: "numeric", language: "sql" }],
};

function stubBackend() {
  vi.stubGlobal("window", {
    __TAURI__: { core: { invoke: async (cmd: string) => RESPONSES[cmd] ?? null } },
  });
}

const BASE: ShellState = {
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
};

async function walk(actions: { node: TreeNode }[]): Promise<ShellState> {
  let s = BASE;
  const dispatch = (a: Action) => {
    s = reducer(s, a);
  };
  for (const { node } of actions) {
    await loadChildren(node, dispatch, () => s.defs);
  }
  return s;
}

const node = (key: string, kind: TreeNode["kind"], extra: Partial<TreeNode> = {}): TreeNode => ({
  key,
  label: key,
  kind,
  connId: "c1",
  ...extra,
});

describe("explorer loading flow", () => {
  beforeEach(() => stubBackend());

  it("walks conn → schema → tables → describe → columns", async () => {
    const s = await walk([
      { node: node("conn:c1", "schemas") },
      { node: node("schema:c1:public", "schema", { schema: "public" }) },
      { node: node("group-tables:c1:public", "group-tables", { schema: "public" }) },
    ]);
    expect(s.explorer["conn:c1"].items.map((i) => i.label)).toEqual(["public"]);
    expect(s.explorer["group-tables:c1:public"].items.map((i) => i.label)).toEqual(["orders"]);

    const s2 = await (async () => {
      let cur: ShellState = s;
      const dispatch = (a: Action) => {
        cur = reducer(cur, a);
      };
      await loadChildren(
        node("table:c1:public:orders", "table", { schema: "public", table: "orders" }),
        dispatch,
        () => cur.defs,
      );
      return cur;
    })();
    const groups = s2.explorer["table:c1:public:orders"].items.map((i) => i.label);
    expect(groups).toEqual(["Columns (2)", "Indexes (1)", "Foreign Keys (1)"]);
    expect(s2.defs["table:c1:public:orders"].foreign_keys[0].ref_table).toBe("users");
  });

  it("separates views and lists functions", async () => {
    const s = await walk([
      { node: node("group-views:c1:public", "group-views", { schema: "public" }) },
      { node: node("group-funcs:c1:public", "group-funcs", { schema: "public" }) },
    ]);
    expect(s.explorer["group-views:c1:public"].items.map((i) => i.label)).toEqual(["big_orders"]);
    expect(s.explorer["group-funcs:c1:public"].items.map((i) => i.label)).toEqual(["total_sales()"]);
  });

  it("records backend failures on the node", async () => {
    vi.stubGlobal("window", {
      __TAURI__: { core: { invoke: async () => { throw { title: "Boom", causes: [], code: "x" }; } } },
    });
    const s = await walk([{ node: node("conn:c1", "schemas") }]);
    expect(s.explorer["conn:c1"].status).toBe("error");
    expect(s.explorer["conn:c1"].error?.title).toBe("Boom");
  });
});
