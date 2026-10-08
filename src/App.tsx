import { useEffect } from "react";
import { ActivityBar } from "./shell/ActivityBar";
import { BottomPanel } from "./shell/BottomPanel";
import { CommandPalette } from "./shell/CommandPalette";
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
    </div>
  );
}
