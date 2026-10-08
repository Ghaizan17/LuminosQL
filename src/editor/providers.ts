import type * as MonacoNS from "monaco-editor";
import { backend } from "../db/backend";
import type { ColumnInfo } from "../db/types";
import { parseTableRefs } from "../sql/aliases";
import { formatSql } from "../sql/format";
import { suggestFor, type SchemaSnapshot, type TableSummary } from "../sql/suggest";
import type { Action } from "../state/store";

type Monaco = typeof MonacoNS;

/** Live schema view exposed to the Monaco providers. */
export interface SchemaContext {
  connId: string | null;
  defaultSchema: string;
  tables: TableSummary[];
  /** Columns from cache, or fetched + cached via describe. */
  columns: (schema: string | undefined, table: string) => Promise<ColumnInfo[]>;
}

const KIND_MAP = {
  keyword: "Keyword",
  table: "Class",
  column: "Field",
  function: "Function",
  schema: "Module",
} as const;

function toSnapshot(ctx: SchemaContext, extra: Record<string, ColumnInfo[]>): SchemaSnapshot {
  return { tables: ctx.tables, columnsByTable: extra, defaultSchema: ctx.defaultSchema };
}

/** Register once per app lifetime; `getCtx` is read fresh on every invocation. */
export function registerSqlProviders(monaco: Monaco, getCtx: () => SchemaContext) {
  const disposables: { dispose(): void }[] = [];

  disposables.push(
    monaco.languages.registerCompletionItemProvider("sql", {
      triggerCharacters: [".", " "],
      async provideCompletionItems(model, position) {
        const ctx = getCtx();
        const offset = model.getOffsetAt(position);
        const sql = model.getValue();
        // Prime column caches for every table referenced, so `alias.` works
        // even before the user browses the table in the explorer.
        const refs = parseTableRefs(sql);
        const extra: Record<string, ColumnInfo[]> = {};
        await Promise.all(
          refs.map(async (r) => {
            const cols = await ctx.columns(r.schema, r.table).catch(() => []);
            extra[`${r.schema ?? ctx.defaultSchema}.${r.table}`.toLowerCase()] = cols;
          }),
        );
        const suggestions = suggestFor(sql, offset, toSnapshot(ctx, extra));
        return {
          suggestions: suggestions.map((s) => ({
            label: s.label,
            kind: monaco.languages.CompletionItemKind[KIND_MAP[s.kind]],
            detail: s.detail,
            insertText: s.label,
            range: {
              startLineNumber: position.lineNumber,
              endLineNumber: position.lineNumber,
              startColumn: position.column,
              endColumn: position.column,
            },
          })),
        };
      },
    }),
  );

  disposables.push(
    monaco.languages.registerHoverProvider("sql", {
      provideHover(model, position) {
        const ctx = getCtx();
        const word = model.getWordAtPosition(position)?.word.toLowerCase();
        if (!word) return null;
        const table = ctx.tables.find((t) => t.name.toLowerCase() === word);
        if (!table) return null;
        return {
          contents: [{ value: `**${table.schema}.${table.name}** — ⌃click for definition` }],
        };
      },
    }),
  );

  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider("sql", {
      async provideDocumentFormattingEdits(model) {
        return [
          {
            range: model.getFullModelRange(),
            text: formatSql(model.getValue()),
          },
        ];
      },
    }),
  );

  return () => disposables.forEach((d) => d.dispose());
}

/** "Go to Table Definition" — opens a DDL snapshot tab for the table under the cursor. */
export function tableDefinitionAt(
  model: { getValue(): string; getWordAtPosition(p: { lineNumber: number; column: number }): { word: string } | null },
  position: { lineNumber: number; column: number },
  ctx: SchemaContext,
): TableSummary | null {
  const word = model.getWordAtPosition(position)?.word.toLowerCase();
  if (!word) return null;
  return ctx.tables.find((t) => t.name.toLowerCase() === word) ?? null;
}

export async function openTableDefinition(
  table: TableSummary,
  connId: string,
  dispatch: React.Dispatch<Action>,
) {
  const ddl = await backend.tableDdl(connId, table.schema, table.name);
  dispatch({
    type: "open-tab",
    tab: {
      id: `ddl-${connId}-${table.schema}-${table.name}`,
      title: `${table.name}.sql`,
      content: `-- Definition of ${table.schema}.${table.name} (read-only snapshot)\n${ddl}`,
      kind: "sql",
    },
  });
}
