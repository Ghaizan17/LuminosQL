import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backend, DesktopUnavailable, isDesktop } from "../src/db/backend";

/** Stands in for the real Tauri v2 core module. The app must reach the
 *  backend through THIS module — the v1-style `window.__TAURI__` global does
 *  not exist in Tauri v2 unless `app.withGlobalTauri` is enabled, so a bridge
 *  built on it silently fails inside the packaged app. */
const { coreInvoke } = vi.hoisted(() => ({ coreInvoke: vi.fn(async (cmd: string) => ({ cmd })) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: coreInvoke }));

afterEach(() => {
  vi.unstubAllGlobals();
  coreInvoke.mockClear();
});

describe("desktop IPC bridge", () => {
  describe("outside the desktop shell", () => {
    beforeEach(() => vi.stubGlobal("window", {}));

    it("reports the shell as unavailable", () => {
      expect(isDesktop()).toBe(false);
    });

    it("fails loudly instead of pretending a connection exists", async () => {
      await expect(backend.listConnections()).rejects.toBeInstanceOf(DesktopUnavailable);
      expect(coreInvoke).not.toHaveBeenCalled();
    });

    it("explains how to get a real backend", async () => {
      await expect(backend.listConnections()).rejects.toThrow(/npm run tauri dev/);
    });
  });

  describe("inside the desktop shell", () => {
    beforeEach(() => vi.stubGlobal("window", { __TAURI_INTERNALS__: {} }));

    it("reports the shell as available", () => {
      expect(isDesktop()).toBe(true);
    });

    it("forwards the command and arguments to the Tauri core", async () => {
      await backend.listTables("conn-1", "public");
      expect(coreInvoke).toHaveBeenCalledWith("list_tables", { id: "conn-1", schema: "public" });
    });

    it("sends no argument object for commands that take none", async () => {
      await backend.listConnections();
      expect(coreInvoke).toHaveBeenCalledWith("list_connections", undefined);
    });
  });
});