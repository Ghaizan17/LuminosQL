import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import { backend } from "../db/backend";
import { useStore } from "../state/store";
import { monaco } from "./monacoSetup";
import {
  openTableDefinition,
  registerSqlProviders,
  tableDefinitionAt,
  type SchemaContext,
} from "./providers";

/** Fresh schema context per render; providers call the latest via ref. */
let ctxGetter: () => SchemaContext = () => ({
  connId: null,
  defaultSchema: "public",
  tables: [],
  columns: async () => [],
});
let providersMounted = false;

interface Props {
  tabId: string;
  value: string;
  onRun: (sql: string) => void;
}

export function SqlEditor({ tabId, value, onRun }: Props) {
  const { state, dispatch } = useStore();
  const onRunRef = useRef(onRun);
  onRunRef.current = onRun;
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  ctxGetter = () => {
    const view = state.connections.find((c) => c.profile.id === state.activeConnectionId);
    const live = view?.live ? view : null;
    const engine = live?.profile.engine;
    const defaultSchema =
      engine === "postgres" ? "public" : engine === "mysql" ? live!.profile.database : "main";
    const seen: Record<string, true> = {};
    const tables: { schema: string; name: string }[] = [];
    for (const cache of Object.values(state.explorer)) {
      for (const n of cache.items) {
        if ((n.kind === "table" || n.kind === "view") && n.schema && n.table) {
          const k = `${n.schema}.${n.table}`.toLowerCase();
          if (!seen[k]) {
            seen[k] = true;
            tables.push({ schema: n.schema, name: n.table });
          }
        }
      }
    }
    return {
      connId: live?.profile.id ?? null,
      defaultSchema,
      tables,
      columns: async (schema, table) => {
        const s = schema ?? defaultSchema;
        const key = `table:${live?.profile.id}:${s}:${table}`;
        const cached = state.defs[key];
        if (cached) return cached.columns;
        if (!live) return [];
        try {
          const def = await backend.describeTable(live.profile.id, s, table);
          dispatch({ type: "tree-def", key, def });
          return def.columns;
        } catch {
          return [];
        }
      },
    };
  };

  const handleMount: OnMount = (editor, monacoInstance) => {
    editorRef.current = editor;
    monacoInstance.editor.setTheme(state.theme === "dark" ? "luminos-dark" : "luminos-light");
    if (!providersMounted) {
      providersMounted = true;
      registerSqlProviders(monacoInstance, () => ctxGetter());
    }
    editor.addAction({
      id: "goto-table-definition",
      label: "Go to Table Definition",
      keybindings: [monacoInstance.KeyCode.F12],
      contextMenuGroupId: "navigation",
      run: (ed) => {
        const pos = ed.getPosition();
        const model = ed.getModel();
        if (!pos || !model) return;
        const table = tableDefinitionAt(model, pos, ctxGetter());
        const cid = ctxGetter().connId;
        if (table && cid) void openTableDefinition(table, cid, dispatch);
      },
    });
    editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter, () => {
      const model = editor.getModel();
      if (!model) return;
      const sel = editor.getSelection();
      const text = sel && !sel.isEmpty() ? model.getValueInRange(sel) : model.getValue();
      onRunRef.current(text);
    });
  };


  // Sync app theme into Monaco.
  useEffect(() => {
    monaco.editor.setTheme(state.theme === "dark" ? "luminos-dark" : "luminos-light");
  }, [state.theme]);

  // Render Problems state as Monaco markers on this tab's model.
  const problems = state.problems[tabId] ?? [];
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "luminos",
      problems.map((p) => ({
        startLineNumber: p.line,
        startColumn: p.column,
        endLineNumber: p.line,
        endColumn: p.column + 1,
        message: p.message,
        severity:
          p.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      })),
    );
  }, [problems, tabId]);

  return (
    <Editor
      height="100%"
      language="sql"
      value={value}
      theme={state.theme === "dark" ? "luminos-dark" : "luminos-light"}
      onChange={(v) => dispatch({ type: "edit-tab", id: tabId, content: v ?? "" })}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        renderWhitespace: "selection",
        suggestOnTriggerCharacters: true,
        quickSuggestions: true,
      }}
    />
  );
}
