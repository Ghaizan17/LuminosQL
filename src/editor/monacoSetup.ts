/** Local Monaco setup — no CDN. The editor bundle ships with the app and
 *  works offline (offline-first is a core requirement).
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

// SQL needs no web worker (only TS/CSS/HTML do), so the editor runs on the
// main thread. This keeps the offline bundle simple and the build green.
loader.config({ monaco });

monaco.editor.defineTheme("luminos-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#1e1e1e",
    "editor.foreground": "#cccccc",
    "editor.lineHighlightBackground": "#2a2d2e",
    "editorLineNumber.foreground": "#858585",
    "editorCursor.foreground": "#007acc",
    "editor.selectionBackground": "#264f78",
  },
});

monaco.editor.defineTheme("luminos-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#333333",
    "editor.lineHighlightBackground": "#e8e8e8",
    "editorCursor.foreground": "#0065b8",
    "editor.selectionBackground": "#add6ff",
  },
});

export { monaco };
