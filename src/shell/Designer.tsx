import { useEffect, useMemo, useRef, useState } from "react";
import { backend, toFriendlyError } from "../db/backend";
import type { Engine, FriendlyError, TableDef } from "../db/types";
import { anchor, edgePath, gridLayout } from "../designer/layout";
import { useStore } from "../state/store";

export interface DesignRef {
  connId: string;
  schema: string;
}

const BOX_W = 230;
const ROW_H = 18;
const HEAD_H = 30;

function boxHeight(def: TableDef): number {
  return HEAD_H + def.columns.length * ROW_H + 10;
}

function storageKey(connId: string, schema: string): string {
  return `luminosql.design.${connId}.${schema}`;
}

function loadPositions(connId: string, schema: string): Record<string, { x: number; y: number }> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(connId, schema)) ?? "{}");
  } catch {
    return {};
  }
}

export function Designer({ designRef, engine }: { designRef: DesignRef; engine: Engine }) {
  const { connId, schema } = designRef;
  const { dispatch } = useStore();
  const [tables, setTables] = useState<TableDef[] | null>(null);
  const [error, setError] = useState<FriendlyError | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(() =>
    loadPositions(connId, schema),
  );
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [fkForm, setFkForm] = useState(false);
  const [fk, setFk] = useState({ from: "", fromCol: "", to: "", toCol: "", name: "" });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ table: string; dx: number; dy: number } | { pan: boolean; sx: number; sy: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    backend
      .listTables(connId, schema)
      .then(async (infos) => {
        const defs = await Promise.all(
          infos.filter((t) => t.kind === "table").map((t) => backend.describeTable(connId, schema, t.name).catch(() => null)),
        );
        if (!cancelled) setTables(defs.filter((d): d is TableDef => d !== null));
      })
      .catch((e) => {
        if (!cancelled) setError(toFriendlyError(e));
      });
    return () => {
      cancelled = true;
    };
  }, [connId, schema]);

  const placed = useMemo(() => {
    if (!tables) return {};
    const sizes = Object.fromEntries(tables.map((t) => [t.name, { id: t.name, w: BOX_W, h: boxHeight(t) }]));
    const auto = gridLayout(tables.map((t) => t.name), sizes);
    const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
    for (const t of tables) {
      const saved = positions[t.name];
      out[t.name] = { w: BOX_W, h: boxHeight(t), x: saved?.x ?? auto[t.name].x, y: saved?.y ?? auto[t.name].y };
    }
    return out;
  }, [tables, positions]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(connId, schema), JSON.stringify(positions));
    } catch {
      /* private mode */
    }
  }, [positions, connId, schema]);

  const edges = useMemo(() => {
    if (!tables) return [];
    const out: { id: string; d: string; label: string; lx: number; ly: number; title: string }[] = [];
    for (const t of tables) {
      const a = placed[t.name];
      if (!a) continue;
      for (const fk of t.foreign_keys) {
        const b = placed[fk.ref_table];
        if (!b) continue;
        const { from, to } = anchor({ id: t.name, ...a }, { id: fk.ref_table, ...b });
        const lx = (from.x + to.x) / 2;
        const ly = (from.y + to.y) / 2 - 6;
        out.push({
          id: `${t.name}.${fk.name}`,
          d: edgePath(from, to),
          label: "1:N",
          lx,
          ly,
          title: `${fk.name}: (${fk.columns.join(", ")}) → ${fk.ref_table} (${fk.ref_columns.join(", ")})`,
        });
      }
    }
    return out;
  }, [tables, placed]);

  const onWheel = (e: React.WheelEvent) => {
    const k = Math.min(2.5, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    setView((v) => ({ ...v, k }));
  };

  const startPan = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".table-box")) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { pan: true, sx: e.clientX, sy: e.clientY };
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if ("pan" in d) {
      setView((v) => ({ ...v, x: v.x + (e.clientX - d.sx), y: v.y + (e.clientY - d.sy) }));
      dragRef.current = { pan: true, sx: e.clientX, sy: e.clientY };
    } else {
      const dx = (e.clientX - d.dx) / view.k;
      const dy = (e.clientY - d.dy) / view.k;
      setPositions((p) => ({ ...p, [d.table]: { x: dx, y: dy } }));
    }
  };

  const generateSql = async () => {
    if (!tables) return;
    try {
      const parts = await Promise.all(tables.map((t) => backend.tableDdl(connId, schema, t.name)));
      dispatch({
        type: "open-tab",
        tab: {
          id: `design-ddl-${connId}-${schema}`,
          title: `${schema}-schema.sql`,
          content: `-- Generated from ${schema} diagram\n\n${parts.join("\n")}`,
          kind: "sql",
        },
      });
    } catch (e) {
      setError(toFriendlyError(e));
    }
  };

  const exportSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${schema}-diagram.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const addRelationship = async () => {
    if (engine === "sqlite") {
      setError({ title: "SQLite cannot add constraints to existing tables.", causes: ["Recreate the table with the REFERENCES clause instead."], code: "unsupported" });
      return;
    }
    const name = fk.name.trim() || `fk_${fk.from}_${fk.to}`;
    const sql =
      engine === "mysql"
        ? `ALTER TABLE \`${schema}\`.\`${fk.from}\` ADD CONSTRAINT \`${name}\` FOREIGN KEY (\`${fk.fromCol}\`) REFERENCES \`${schema}\`.\`${fk.to}\` (\`${fk.toCol}\`);`
        : `ALTER TABLE "${schema}"."${fk.from}" ADD CONSTRAINT "${name}" FOREIGN KEY ("${fk.fromCol}") REFERENCES "${schema}"."${fk.to}" ("${fk.toCol}");`;
    try {
      await backend.executeSql(connId, sql);
      setFkForm(false);
      setFk({ from: "", fromCol: "", to: "", toCol: "", name: "" });
      const defs = await Promise.all(
        (tables ?? []).map((t) => backend.describeTable(connId, schema, t.name).catch(() => null)),
      );
      setTables(defs.filter((d): d is TableDef => d !== null));
    } catch (e) {
      setError(toFriendlyError(e));
    }
  };

  return (
    <div className="designer">
      <div className="editor-toolbar">
        <button onClick={() => setView((v) => ({ ...v, k: Math.min(2.5, v.k * 1.2) }))}>+</button>
        <button onClick={() => setView((v) => ({ ...v, k: Math.max(0.2, v.k / 1.2) }))}>−</button>
        <button onClick={() => setView({ x: 0, y: 0, k: 1 })}>Reset</button>
        <button onClick={() => setPositions({})}>Auto-layout</button>
        <button onClick={generateSql} disabled={!tables}>Generate SQL</button>
        <button onClick={exportSvg} disabled={!tables}>Export SVG</button>
        <button onClick={() => setFkForm((v) => !v)}>+ Relationship</button>
        <span className="conn-label">{schema} · {tables ? `${tables.length} tables` : "loading…"}</span>
      </div>
      {error && (
        <div className="form-error" role="alert">
          <strong>{error.title}</strong>
          {error.causes.map((c) => (
            <div key={c}>• {c}</div>
          ))}
        </div>
      )}
      {fkForm && (
        <div className="fk-form">
          <select value={fk.from} onChange={(e) => setFk((f) => ({ ...f, from: e.target.value }))}>
            <option value="">from table…</option>
            {(tables ?? []).map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
          <input placeholder="column" value={fk.fromCol} onChange={(e) => setFk((f) => ({ ...f, fromCol: e.target.value }))} />
          <span>→</span>
          <select value={fk.to} onChange={(e) => setFk((f) => ({ ...f, to: e.target.value }))}>
            <option value="">to table…</option>
            {(tables ?? []).map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
          <input placeholder="column" value={fk.toCol} onChange={(e) => setFk((f) => ({ ...f, toCol: e.target.value }))} />
          <input placeholder="constraint name (optional)" value={fk.name} onChange={(e) => setFk((f) => ({ ...f, name: e.target.value }))} />
          <button className="primary" disabled={!fk.from || !fk.fromCol || !fk.to || !fk.toCol} onClick={addRelationship}>
            Create FK
          </button>
        </div>
      )}
      <svg
        ref={svgRef}
        className="canvas"
        onWheel={onWheel}
        onPointerDown={startPan}
        onPointerMove={onMove}
        onPointerUp={() => (dragRef.current = null)}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {edges.map((e) => (
            <g key={e.id}>
              <title>{e.title}</title>
              <path d={e.d} className="edge" />
              <text x={e.lx} y={e.ly} className="edge-label" textAnchor="middle">{e.label}</text>
            </g>
          ))}
          {(tables ?? []).map((t) => {
            const p = placed[t.name];
            if (!p) return null;
            return (
              <g
                key={t.name}
                className="table-box"
                transform={`translate(${p.x},${p.y})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  dragRef.current = { table: t.name, dx: e.clientX - p.x * view.k, dy: e.clientY - p.y * view.k };
                }}
                onPointerMove={onMove}
                onPointerUp={() => (dragRef.current = null)}
              >
                <rect width={p.w} height={p.h} rx={6} className="box" />
                <text x={10} y={20} className="box-title">{t.name}</text>
                {t.columns.map((c, i) => (
                  <text key={c.name} x={10} y={HEAD_H + i * ROW_H} className="box-col">
                    {c.pk_position ? "🔑 " : t.foreign_keys.some((f) => f.columns.includes(c.name)) ? "🔗 " : ""}
                    {c.name}: {c.data_type}
                  </text>
                ))}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
