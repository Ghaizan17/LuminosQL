import { useCallback, useEffect, useState } from "react";
import { backend, toFriendlyError } from "../db/backend";
import type { FilterOp, FriendlyError, TableDef } from "../db/types";

export interface DataRef {
  connId: string;
  schema: string;
  table: string;
}

interface PageData {
  columns: string[];
  rows: unknown[][];
  total: number;
}

const OPS: { value: FilterOp; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "like", label: "LIKE" },
  { value: "isnull", label: "IS NULL" },
  { value: "isnotnull", label: "IS NOT NULL" },
];

const OP_LABEL: Record<FilterOp, string> = {
  eq: "=", ne: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", like: "LIKE", isnull: "IS NULL", isnotnull: "IS NOT NULL",
};

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function toCsv(columns: string[], rows: unknown[][]): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return [columns.map(q).join(","), ...rows.map((r) => r.map((v) => q(cellText(v))).join(","))].join("\n");
}

export function DataGrid({ dataRef }: { dataRef: DataRef }) {
  const { connId, schema, table } = dataRef;
  const [def, setDef] = useState<TableDef | null>(null);
  const [page, setPage] = useState<PageData | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(null);
  const [filters, setFilters] = useState<{ column: string; op: FilterOp; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editNull, setEditNull] = useState(false);
  const [jsonView, setJsonView] = useState<string | null>(null);
  const [inserting, setInserting] = useState(false);
  const [insertVals, setInsertVals] = useState<Record<string, string>>({});
  const [fCol, setFCol] = useState("");
  const [fOp, setFOp] = useState<FilterOp>("eq");
  const [fVal, setFVal] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, p] = await Promise.all([
        backend.describeTable(connId, schema, table),
        backend.tablePage(connId, schema, table, {
          page: pageIdx,
          page_size: pageSize,
          sort,
          filters: filters.map((f) => ({ column: f.column, op: f.op, value: f.value })),
        }),
      ]);
      setDef(d);
      setPage({ columns: p.page.columns.map((c) => c.name), rows: p.page.rows, total: p.total_rows });
    } catch (e) {
      setError(toFriendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [connId, schema, table, pageIdx, pageSize, sort, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const pkCols = def?.columns.filter((c) => c.pk_position !== null).map((c) => c.name) ?? [];
  const colIndex = (name: string) => page?.columns.indexOf(name) ?? -1;

  const pkOf = (row: unknown[]): [string, string | null][] =>
    pkCols.map((c) => {
      const v = row[colIndex(c)];
      return [c, v === null || v === undefined ? null : String(v)];
    });

  const commitEdit = async (rowIdx: number, col: string) => {
    const row = page!.rows[rowIdx];
    setEditing(null);
    try {
      await backend.updateCell(connId, schema, table, pkOf(row), col, editNull ? null : editValue);
      await load();
    } catch (e) {
      setError(toFriendlyError(e));
    }
  };

  const removeRow = async (row: unknown[]) => {
    if (!window.confirm(`Delete this row from ${table}?`)) return;
    try {
      await backend.deleteRow(connId, schema, table, pkOf(row));
      await load();
    } catch (e) {
      setError(toFriendlyError(e));
    }
  };

  const duplicateRow = async (row: unknown[]) => {
    const values = page!.columns
      .filter((c) => !pkCols.includes(c))
      .map((c): [string, string | null] => {
        const v = row[colIndex(c)];
        return [c, v === null || v === undefined ? null : String(v)];
      });
    try {
      await backend.insertRow(connId, schema, table, values);
      await load();
    } catch (e) {
      setError(toFriendlyError(e));
    }
  };

  const commitInsert = async () => {
    const values = (def?.columns ?? []).map((c): [string, string | null] => {
      const v = (insertVals[c.name] ?? "").trim();
      return [c.name, v === "" ? null : v];
    });
    try {
      await backend.insertRow(connId, schema, table, values);
      setInserting(false);
      setInsertVals({});
      await load();
    } catch (e) {
      setError(toFriendlyError(e));
    }
  };

  const exportCsv = () => {
    if (!page) return;
    const blob = new Blob([toCsv(page.columns, page.rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${table}-page${pageIdx + 1}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const totalPages = page ? Math.max(1, Math.ceil(page.total / pageSize)) : 1;

  return (
    <div className="datagrid">
      <div className="grid-toolbar">
        <button disabled={pageIdx === 0 || loading} onClick={() => setPageIdx((p) => p - 1)}>‹ Prev</button>
        <span>
          Page {pageIdx + 1} of {totalPages} ({page?.total ?? "…"} rows)
        </span>
        <button disabled={pageIdx + 1 >= totalPages || loading} onClick={() => setPageIdx((p) => p + 1)}>Next ›</button>
        <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPageIdx(0); }}>
          {[50, 100, 500, 1000].map((n) => (
            <option key={n} value={n}>{n}/page</option>
          ))}
        </select>
        <button onClick={() => setInserting((v) => !v)}>+ Row</button>
        <button onClick={exportCsv} disabled={!page}>Export CSV</button>
        <button onClick={() => void load()}>Refresh</button>
        <span className="muted">{pkCols.length === 0 ? "read-only: no primary key" : ""}</span>
      </div>
      <div className="grid-filters">
        <select value={fCol} onChange={(e) => setFCol(e.target.value)}>
          <option value="">filter column…</option>
          {(page?.columns ?? []).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={fOp} onChange={(e) => setFOp(e.target.value as FilterOp)}>
          {OPS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {!["isnull", "isnotnull"].includes(fOp) && (
          <input value={fVal} placeholder="value" onChange={(e) => setFVal(e.target.value)} />
        )}
        <button
          disabled={!fCol}
          onClick={() => {
            setFilters((fs) => [...fs, { column: fCol, op: fOp, value: fVal }]);
            setPageIdx(0);
            setFVal("");
          }}
        >
          Add
        </button>
        {filters.map((f, i) => (
          <span className="chip" key={i}>
            {f.column} {OP_LABEL[f.op]} {f.value}
            <button className="mini" onClick={() => { setFilters((fs) => fs.filter((_, j) => j !== i)); setPageIdx(0); }}>×</button>
          </span>
        ))}
      </div>
      {error && (
        <div className="form-error" role="alert">
          <strong>{error.title}</strong>
          {error.causes.map((c) => (
            <div key={c}>• {c}</div>
          ))}
        </div>
      )}
      {inserting && def && (
        <div className="insert-row">
          {def.columns.map((c) => (
            <label key={c.name}>
              {c.name}
              <input
                value={insertVals[c.name] ?? ""}
                placeholder={c.pk_position ? "auto" : "NULL"}
                onChange={(e) => setInsertVals((m) => ({ ...m, [c.name]: e.target.value }))}
              />
            </label>
          ))}
          <button className="primary" onClick={commitInsert}>Insert</button>
        </div>
      )}
      <div className="grid-scroll">
        {loading && !page ? (
          <div className="placeholder">Loading…</div>
        ) : (
          <table className="result-grid data">
            <thead>
              <tr>
                {(page?.columns ?? []).map((c) => (
                  <th key={c} onClick={() => { setSort((s) => (s?.column === c && !s.desc ? { column: c, desc: true } : s?.column === c ? null : { column: c, desc: false })); setPageIdx(0); }} title="Sort">
                    {c}{sort?.column === c ? (sort.desc ? " ▼" : " ▲") : ""}
                  </th>
                ))}
                <th className="actions" />
              </tr>
            </thead>
            <tbody>
              {(page?.rows ?? []).map((row, i) => (
                <tr key={i}>
                  {(row as unknown[]).map((v, j) => {
                    const col = page!.columns[j];
                    const isEditing = editing?.row === i && editing?.col === col;
                    const text = cellText(v);
                    const long = text.length > 60;
                    return (
                      <td
                        key={j}
                        className={v === null ? "null" : ""}
                        title={long ? "Click to view full value" : undefined}
                        onDoubleClick={() => {
                          if (pkCols.length === 0) return;
                          setEditing({ row: i, col });
                          setEditValue(v === null ? "" : String(v));
                          setEditNull(v === null);
                        }}
                        onClick={() => {
                          if (long) setJsonView(text);
                        }}
                      >
                        {isEditing ? (
                          <span className="cell-editor">
                            <input
                              autoFocus
                              value={editValue}
                              disabled={editNull}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitEdit(i, col);
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                            <label>
                              <input type="checkbox" checked={editNull} onChange={(e) => setEditNull(e.target.checked)} /> NULL
                            </label>
                          </span>
                        ) : (
                          text.slice(0, 60)
                        )}
                      </td>
                    );
                  })}
                  <td className="actions">
                    <button className="mini" title="Duplicate row" onClick={() => void duplicateRow(row)}>⧉</button>
                    <button className="mini danger" title="Delete row" onClick={() => void removeRow(row)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {jsonView !== null && (
        <div className="palette-backdrop" onClick={() => setJsonView(null)}>
          <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
            <h2>Cell value</h2>
            <pre className="sql-preview">{jsonView}</pre>
            <div className="dialog-actions">
              <button onClick={() => { void navigator.clipboard?.writeText(jsonView); }}>Copy</button>
              <button className="primary" onClick={() => setJsonView(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
