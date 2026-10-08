import { useState } from "react";
import { backend, toFriendlyError } from "../db/backend";
import { buildSelectAll } from "../db/sqlBuilder";
import type { Engine, TableDef } from "../db/types";
import { useStore, type Action, type TreeNode } from "../state/store";
import { DropModal, NewTableDialog, RenameDialog } from "./TableDialogs";


interface MenuState {
  node: TreeNode;
  x: number;
  y: number;
}
export const connKey = (cid: string) => `conn:${cid}`;
const schemaKey = (cid: string, s: string) => `schema:${cid}:${s}`;
const groupKey = (g: string, cid: string, s: string) => `${g}:${cid}:${s}`;
const tableKey = (cid: string, s: string, t: string) => `table:${cid}:${s}:${t}`;

/** Substring scope covering a node and everything beneath it. */
function scopeFor(node: TreeNode): string {
  if (node.kind === "schemas") return `:${node.connId}`;
  if (node.table) return `:${node.connId}:${node.schema}:${node.table}`;
  if (node.schema) return `:${node.connId}:${node.schema}`;
  return `:${node.connId}`;
}
type DialogState =
  | { kind: "new-table"; connId: string; engine: Engine; schema: string }
  | { kind: "rename"; connId: string; engine: Engine; schema: string; table: string }
  | { kind: "drop"; connId: string; engine: Engine; schema: string; table: string; sql: string }
  | null;
export async function loadChildren(
  node: TreeNode,
  dispatch: React.Dispatch<Action>,
  getDefs: () => Record<string, TableDef>,
): Promise<void> {
  const { connId: cid, schema: s, table: t } = node;
  dispatch({ type: "tree-loading", key: node.key });
  try {
    switch (node.kind) {
      case "schemas": {
        const schemas = await backend.listSchemas(cid);
        dispatch({
          type: "tree-ready",
          key: node.key,
          items: schemas.map((x) => ({ key: schemaKey(cid, x.name), label: x.name, kind: "schema" as const, connId: cid, schema: x.name })),
        });
        break;
      }
      case "schema": {
        dispatch({
          type: "tree-ready",
          key: node.key,
          items: [
            { key: groupKey("group-tables", cid, s!), label: "Tables", kind: "group-tables" as const, connId: cid, schema: s },
            { key: groupKey("group-views", cid, s!), label: "Views", kind: "group-views" as const, connId: cid, schema: s },
            { key: groupKey("group-funcs", cid, s!), label: "Functions", kind: "group-funcs" as const, connId: cid, schema: s },
          ],
        });
        break;
      }
      case "group-tables":
      case "group-views": {
        const want = node.kind === "group-tables" ? "table" : "view";
        const tables = (await backend.listTables(cid, s!)).filter((x) => x.kind === want);
        dispatch({
          type: "tree-ready",
          key: node.key,
          items: tables.map((x) => ({
            key: tableKey(cid, s!, x.name),
            label: x.name,
            kind: (want === "table" ? "table" : "view") as TreeNode["kind"],
            connId: cid,
            schema: s,
            table: x.name,
          })),
        });
        break;
      }
      case "group-funcs": {
        const funcs = await backend.listFunctions(cid, s!);
        dispatch({
          type: "tree-ready",
          key: node.key,
          items: funcs.map((f) => ({
            key: `func:${cid}:${s}:${f.name}`,
            label: `${f.name}(${f.arguments})`,
            kind: "function" as const,
            detail: f.return_type,
            connId: cid,
            schema: s,
          })),
        });
        break;
      }
      case "table":
      case "view": {
        const def = await backend.describeTable(cid, s!, t!);
        const key = tableKey(cid, s!, t!);
        dispatch({ type: "tree-def", key, def });
        dispatch({
          type: "tree-ready",
          key: node.key,
          items: [
            { key: groupKey("group-cols", cid, `${s}.${t}`), label: `Columns (${def.columns.length})`, kind: "group-cols" as const, connId: cid, schema: s, table: t },
            { key: groupKey("group-idx", cid, `${s}.${t}`), label: `Indexes (${def.indexes.length})`, kind: "group-idx" as const, connId: cid, schema: s, table: t },
            { key: groupKey("group-fk", cid, `${s}.${t}`), label: `Foreign Keys (${def.foreign_keys.length})`, kind: "group-fk" as const, connId: cid, schema: s, table: t },
          ],
        });
        break;
      }
      case "group-cols":
      case "group-idx":
      case "group-fk": {
        // Schema+table were packed as `schema.table` in the group key segment.
        const def = getDefs()[tableKey(cid, s!, t!)];
        if (!def) throw new Error("Table definition expired — collapse and reopen the table.");
        if (node.kind === "group-cols") {
          dispatch({
            type: "tree-ready",
            key: node.key,
            items: def.columns.map((c) => ({
              key: `${node.key}::${c.name}`,
              label: `${c.pk_position ? "🔑 " : ""}${c.name}`,
              kind: "col" as const,
              detail: `${c.data_type}${c.nullable ? "" : " NOT NULL"}${c.default ? ` DEFAULT ${c.default}` : ""}`,
              connId: cid,
              schema: s,
              table: t,
            })),
          });
        } else if (node.kind === "group-idx") {
          dispatch({
            type: "tree-ready",
            key: node.key,
            items: def.indexes.map((ix) => ({
              key: `${node.key}::${ix.name}`,
              label: `${ix.primary ? "🔑 " : ix.unique ? "◆ " : ""}${ix.name}`,
              kind: "idx" as const,
              detail: `(${ix.columns.join(", ")})`,
              connId: cid,
              schema: s,
              table: t,
            })),
          });
        } else {
          dispatch({
            type: "tree-ready",
            key: node.key,
            items: def.foreign_keys.map((fk) => ({
              key: `${node.key}::${fk.name}`,
              label: fk.name,
              kind: "fk" as const,
              detail: `(${fk.columns.join(", ")}) → ${fk.ref_table} (${fk.ref_columns.join(", ")})`,
              connId: cid,
              schema: s,
              table: t,
            })),
          });
        }
        break;
      }
      default:
        dispatch({ type: "tree-ready", key: node.key, items: [] });
    }
  } catch (e) {
    dispatch({ type: "tree-failed", key: node.key, error: toFriendlyError(e) });
  }
}

const LEAF_KINDS: TreeNode["kind"][] = ["col", "idx", "fk", "function"];

function NodeView({ node, depth, onMenu }: { node: TreeNode; depth: number; onMenu: (m: MenuState) => void }) {
  const { state, dispatch } = useStore();
  const open = !!state.expanded[node.key];
  const cache = state.explorer[node.key];
  const leaf = (LEAF_KINDS as string[]).includes(node.kind);

  const toggle = () => {
    if (leaf) return;
    dispatch({ type: "tree-toggle", key: node.key });
    if (!state.expanded[node.key] && !cache) {
      void loadChildren(node, dispatch, () => state.defs);
    }
  };

  return (
    <>
      <div
        className="node tree-node"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={toggle}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onMenu({ node, x: e.clientX, y: e.clientY });
        }}
      >
        {!leaf && <span className="twisty">{open ? "▾" : "▸"}</span>}
        <span className="tree-icon">{iconFor(node.kind)}</span>
        <span className="conn-name">{node.label}</span>
        {node.detail && <span className="tree-detail">{node.detail}</span>}
        {cache?.status === "loading" && <span className="muted"> …</span>}
      </div>
      {open && cache?.status === "error" && (
        <div className="conn-error" style={{ paddingLeft: 8 + (depth + 1) * 14 }}>
          <strong>{cache.error!.title}</strong>
          {cache.error!.causes.map((c) => (
            <div key={c}>• {c}</div>
          ))}
          <button className="mini" onClick={() => loadChildren(node, dispatch, () => state.defs)}>
            Retry
          </button>
        </div>
      )}
      {open &&
        cache?.status === "ready" &&
        cache.items.map((child) => <NodeView key={child.key} node={child} depth={depth + 1} onMenu={onMenu} />)}
    </>
  );
}

function iconFor(kind: TreeNode["kind"]): string {
  switch (kind) {
    case "schemas":
      return "🗄";
    case "schema":
      return "📂";
    case "group-tables":
      return "▦";
    case "group-views":
      return "👁";
    case "group-funcs":
      return "ƒ";
    case "table":
      return "▦";
    case "view":
      return "👁";
    case "function":
      return "ƒ";
    case "group-cols":
      return "☰";
    case "col":
      return "•";
    case "group-idx":
      return "◆";
    case "idx":
      return "◆";
    case "group-fk":
      return "🔗";
    case "fk":
      return "🔗";
  }
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

export function ExplorerTree({ connId, engine }: { connId: string; engine: Engine }) {
  const { state, dispatch } = useStore();
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const rootKey = connKey(connId);
  const root: TreeNode = { key: rootKey, label: "Schemas", kind: "schemas", connId };
  const rootOpen = !!state.expanded[rootKey];

  const toggleRoot = () => {
    dispatch({ type: "tree-toggle", key: rootKey });
    if (!rootOpen && !state.explorer[rootKey]) {
      dispatch({ type: "tree-loading", key: rootKey });
      backend
        .listSchemas(connId)
        .then((schemas) =>
          dispatch({
            type: "tree-ready",
            key: rootKey,
            items: schemas.map((x) => ({
              key: schemaKey(connId, x.name),
              label: x.name,
              kind: "schema" as const,
              connId,
              schema: x.name,
            })),
          }),
        )
        .catch((e) => dispatch({ type: "tree-failed", key: rootKey, error: toFriendlyError(e) }));
    }
  };

  const refreshNode = (node: TreeNode) => {
    dispatch({ type: "tree-drop", match: scopeFor(node) });
    setMenu(null);
    if (state.expanded[node.key]) {
      void loadChildren(node, dispatch, () => state.defs);
    }
  };

  const viewDefinition = async (node: TreeNode) => {
    setMenu(null);
    try {
      const ddl = await backend.tableDdl(node.connId, node.schema!, node.table!);
      dispatch({
        type: "open-tab",
        tab: { id: `ddl-${node.connId}-${node.schema}-${node.table}`, title: `${node.table}.sql`, content: `-- Definition of ${node.schema}.${node.table} (read-only snapshot)\n${ddl}` },
      });
    } catch (e) {
      dispatch({
        type: "open-tab",
        tab: { id: `err-${Date.now()}`, title: "error.txt", content: toFriendlyError(e).title },
      });
    }
  };

  const menuItems = (m: MenuState) => {
    const n = m.node;
    const items: { label: string; disabled?: string; run?: () => void }[] = [];
    if (n.kind === "table" || n.kind === "view") {
      items.push(
        { label: "Open data (Phase 5)", disabled: "Read-only grid has not landed yet" },
        { label: "Copy name", run: () => copy(n.table!) },
        { label: "Copy SELECT *", run: () => copy(buildSelectAll(engine, n.schema!, n.table!)) },
        { label: "View definition", run: () => viewDefinition(n) },
        { label: "Refresh", run: () => refreshNode(n) },
      );
      if (n.kind === "table") {
        items.push(
          { label: "New table in this schema…", run: () => { setDialog({ kind: "new-table", connId: n.connId, engine, schema: n.schema! }); setMenu(null); } },
          { label: "Rename…", run: () => { setDialog({ kind: "rename", connId: n.connId, engine, schema: n.schema!, table: n.table! }); setMenu(null); } },
          { label: "Drop table…", run: () => { setDialog({ kind: "drop", connId: n.connId, engine, schema: n.schema!, table: n.table!, sql: "" }); setMenu(null); } },
        );
      }
    } else if (n.kind === "schema") {
      items.push(
        { label: "New table…", run: () => { setDialog({ kind: "new-table", connId: n.connId, engine, schema: n.schema! }); setMenu(null); } },
        { label: "Copy name", run: () => copy(n.schema!) },
        { label: "Refresh", run: () => refreshNode(n) },
      );
    } else if (n.kind === "schemas") {
      items.push({ label: "Refresh", run: () => refreshNode(n) });
    } else if (n.kind === "function") {
      items.push({ label: "Copy name", run: () => copy(n.label) });
    } else {
      items.push({ label: "Copy name", run: () => copy(n.label.replace(/^[🔑◆•ƒ ]+/, "")) });
    }
    return items;
  };

  return (
    <div className="explorer-tree">
      <div
        className="node tree-node"
        style={{ paddingLeft: 20 }}
        onClick={toggleRoot}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ node: root, x: e.clientX, y: e.clientY });
        }}
      >
        <span className="twisty">{rootOpen ? "▾" : "▸"}</span>
        <span className="tree-icon">🗄</span>
        <span className="conn-name">Schemas</span>
      </div>
      {rootOpen &&
        state.explorer[rootKey]?.items.map((child) => (
          <NodeView key={child.key} node={child} depth={2} onMenu={setMenu} />
        ))}
      {menu && (
        <div className="menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
          <div className="menu" style={{ left: Math.min(menu.x, window.innerWidth - 220), top: menu.y }}>
            {menuItems(menu).map((it) => (
              <button
                key={it.label}
                disabled={!!it.disabled}
                title={it.disabled}
                onClick={() => {
                  it.run?.();
                  if (!it.disabled) setMenu(null);
                }}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {dialog?.kind === "new-table" && (
        <NewTableDialog
          engine={dialog.engine}
          schema={dialog.schema}
          onClose={() => setDialog(null)}
          onDone={() => {
            dispatch({ type: "tree-drop", match: `:${dialog.connId}:${dialog.schema}` });
            setDialog(null);
          }}
          exec={(sql) => backend.executeSql(dialog.connId, sql)}
        />
      )}
      {dialog?.kind === "rename" && (
        <RenameDialog
          engine={dialog.engine}
          schema={dialog.schema}
          table={dialog.table}
          onClose={() => setDialog(null)}
          onDone={() => {
            dispatch({ type: "tree-drop", match: `:${dialog.connId}:${dialog.schema}` });
            setDialog(null);
          }}
          exec={(sql) => backend.executeSql(dialog.connId, sql)}
        />
      )}
      {dialog?.kind === "drop" && (
        <DropModal
          engine={dialog.engine}
          schema={dialog.schema}
          table={dialog.table}
          onClose={() => setDialog(null)}
          onDone={() => {
            dispatch({ type: "tree-drop", match: `:${dialog.connId}:${dialog.schema}` });
            setDialog(null);
          }}
          exec={(sql) => backend.executeSql(dialog.connId, sql)}
        />
      )}
    </div>
  );
}
