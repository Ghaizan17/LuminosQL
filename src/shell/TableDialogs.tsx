import { useMemo, useState } from "react";
import { toFriendlyError } from "../db/backend";
import {
  buildCreateTable,
  buildDropTable,
  buildRenameTable,
  type ColumnSpec,
} from "../db/sqlBuilder";
import type { Engine, FriendlyError } from "../db/types";

interface ExecProps {
  engine: Engine;
  schema: string;
  onClose: () => void;
  onDone: () => void;
  exec: (sql: string) => Promise<number>;
}

function ErrorBox({ error }: { error: FriendlyError | null }) {
  if (!error) return null;
  return (
    <div className="form-error" role="alert">
      <strong>{error.title}</strong>
      {error.causes.length > 0 && (
        <ul>
          {error.causes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const COMMON_TYPES = ["INTEGER", "BIGINT", "TEXT", "VARCHAR(255)", "BOOLEAN", "NUMERIC", "TIMESTAMP", "DATE", "JSON"];

export function NewTableDialog({ engine, schema, onClose, onDone, exec }: ExecProps & { schema: string }) {
  const [table, setTable] = useState("");
  const [columns, setColumns] = useState<ColumnSpec[]>([
    { name: "id", dataType: engine === "postgres" ? "BIGSERIAL" : "INTEGER", nullable: false, primaryKey: true, defaultValue: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  const sql = useMemo(() => buildCreateTable(engine, schema, table || "<table>", columns), [engine, schema, table, columns]);
  const valid = table.trim() !== "" && columns.length > 0 && columns.every((c) => c.name.trim() !== "");

  const setCol = (i: number, patch: Partial<ColumnSpec>) =>
    setColumns((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await exec(buildCreateTable(engine, schema, table.trim(), columns));
      onDone();
    } catch (e) {
      setError(toFriendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New table">
        <h2>New table in {schema}</h2>
        <label>
          Table name
          <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="users" />
        </label>
        {columns.map((c, i) => (
          <div className="row col-row" key={i}>
            <input value={c.name} placeholder="column" onChange={(e) => setCol(i, { name: e.target.value })} />
            <select value={COMMON_TYPES.includes(c.dataType) ? c.dataType : "__custom"} onChange={(e) => setCol(i, { dataType: e.target.value === "__custom" ? c.dataType : e.target.value })}>
              {COMMON_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              {!COMMON_TYPES.includes(c.dataType) && <option value="__custom">{c.dataType} (custom)</option>}
            </select>
            <input
              value={COMMON_TYPES.includes(c.dataType) ? "" : c.dataType}
              placeholder="custom type"
              title="Custom type (e.g. DECIMAL(10,2))"
              onChange={(e) => setCol(i, { dataType: e.target.value || "TEXT" })}
            />
            <label className="check" title="Primary key">
              <input type="checkbox" checked={c.primaryKey} onChange={(e) => setCol(i, { primaryKey: e.target.checked })} /> PK
            </label>
            <label className="check" title="Nullable">
              <input type="checkbox" checked={c.nullable} onChange={(e) => setCol(i, { nullable: e.target.checked })} /> NULL
            </label>
            <button className="mini danger" onClick={() => setColumns((cs) => cs.filter((_, j) => j !== i))} title="Remove column">×</button>
          </div>
        ))}
        <button
          className="mini"
          onClick={() => setColumns((cs) => [...cs, { name: "", dataType: "TEXT", nullable: true, primaryKey: false, defaultValue: "" }])}
        >
          + Add column
        </button>
        <pre className="sql-preview">{sql}</pre>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create} disabled={!valid || busy}>
            {busy ? "Creating…" : "Create table"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function RenameDialog({ engine, schema, table, onClose, onDone, exec }: ExecProps & { table: string }) {
  const [to, setTo] = useState(table);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const sql = buildRenameTable(engine, schema, table, to || "<name>");

  const rename = async () => {
    setBusy(true);
    setError(null);
    try {
      await exec(buildRenameTable(engine, schema, table, to.trim()));
      onDone();
    } catch (e) {
      setError(toFriendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Rename table">
        <h2>Rename {table}</h2>
        <label>
          New name
          <input value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <pre className="sql-preview">{sql}</pre>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={rename} disabled={!to.trim() || to === table || busy}>
            {busy ? "Renaming…" : "Rename"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DropModal({ engine, schema, table, onClose, onDone, exec }: ExecProps & { table: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const sql = buildDropTable(engine, schema, table);

  const drop = async () => {
    setBusy(true);
    setError(null);
    try {
      await exec(sql);
      onDone();
    } catch (e) {
      setError(toFriendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-label="Destructive query">
        <h2>⚠ Destructive Query</h2>
        <p>
          <code>{sql}</code>
        </p>
        <p className="hint">This permanently deletes the table and all its data. This cannot be undone.</p>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <button onClick={onClose} autoFocus>Cancel</button>
          <button className="danger" onClick={drop} disabled={busy}>
            {busy ? "Dropping…" : "Execute Anyway"}
          </button>
        </div>
      </div>
    </div>
  );
}
