import { useEffect } from "react";
import { backend, isDesktop } from "./db/backend";
import { ActivityBar } from "./shell/ActivityBar";
import { BottomPanel } from "./shell/BottomPanel";
import { CommandPalette } from "./shell/CommandPalette";
import { ConnectionDialog } from "./shell/ConnectionDialog";
import { DiagnosticsRunner } from "./editor/DiagnosticsRunner";
import { EditorArea } from "./shell/EditorArea";
import { Sidebar } from "./shell/Sidebar";
import { StatusBar } from "./shell/StatusBar";
import { normalizeKey, SHORTCUTS } from "./state/shortcuts";
import { useStore } from "./state/store";

export function App() {
  const { state, dispatch } = useStore();

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  // Pull saved connections once when running inside the desktop shell.
  // Browser dev mode has no backend — the panel shows that explicitly.
  useEffect(() => {
    if (!isDesktop()) return;
    backend
      .listConnections()
      .then((views) => backend.credentialStoreStatus().catch(() => null).then((storeOsBacked) => ({ views, storeOsBacked })))
      .then(({ views, storeOsBacked }) => dispatch({ type: "connections-loaded", views, storeOsBacked }))
      .catch(() => dispatch({ type: "connections-loaded", views: [], storeOsBacked: null }));
  }, [dispatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = normalizeKey(e);
      const mapped = SHORTCUTS[combo];
      if (!mapped) return;
      e.preventDefault();
      if (mapped === "set-palette") dispatch({ type: "set-palette", open: true });
      else if (mapped === "palette-quick") dispatch({ type: "set-palette", open: true });
      else if (mapped === "toggle-sidebar") dispatch({ type: "toggle-sidebar" });
      else if (mapped === "toggle-bottom") dispatch({ type: "toggle-bottom" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);

  const cls = [
    "shell",
    state.sidebarVisible ? "" : "hide-sidebar",
    state.bottomVisible ? "" : "hide-bottom",
  ].join(" ");

  return (
    <div className={cls}>
      <ActivityBar />
      <Sidebar />
      <EditorArea />
      <BottomPanel />
      <StatusBar />
      <CommandPalette />
      <ConnectionDialog />
      <DiagnosticsRunner />
    </div>
  );
}
