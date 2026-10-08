import type { Action } from "./store";

/**
 * Configurable shortcut map: key combo → action type.
 * Phase 8 makes this user-editable; the map shape is the contract.
 */
export const SHORTCUTS: Record<string, Action["type"] | "palette-quick"> = {
  "ctrl+shift+p": "set-palette",
  "ctrl+p": "palette-quick",
  "ctrl+b": "toggle-sidebar",
  "ctrl+`": "toggle-bottom",
  "ctrl+s": "set-palette", // Phase 4: save file; Phase 1 routes to palette to avoid dead key
  "ctrl+w": "set-palette", // Phase 4: close tab (needs active-tab context); palette for now
  "ctrl+tab": "set-palette",
};

export function normalizeKey(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}
