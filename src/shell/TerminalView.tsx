import { useEffect, useRef, type CSSProperties } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { backend, isDesktop } from "../db/backend";
import "@xterm/xterm/css/xterm.css";

interface TerminalDataEvent {
  id: string;
  data: string;
}

interface TerminalExitEvent {
  id: string;
  code: number | null;
}

/** Maps the app's theme variables onto xterm's ITheme. */
function themeFrom(el: Element): ITheme {
  const s = getComputedStyle(el);
  const bg = s.getPropertyValue("--bg").trim();
  const fg = s.getPropertyValue("--fg").trim();
  const accent = s.getPropertyValue("--accent").trim();
  const muted = s.getPropertyValue("--muted").trim();
  const theme: ITheme = { cursorAccent: accent };
  if (bg) theme.background = bg;
  if (fg) theme.foreground = fg;
  if (accent) {
    theme.selectionBackground = accent;
    theme.black = accent;
  }
  if (muted) {
    theme.brightBlack = muted;
  }
  return theme;
}

const shellStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
  padding: 4,
  background: "var(--bg)",
};

const noticeStyle: CSSProperties = {
  color: "var(--muted)",
  padding: "12px",
  font: "var(--mono)",
  fontSize: 12,
};

/**
 * Renders an xterm.js view bound to an already-open PTY session. The session itself
 * is owned by the parent: unmounting this view (e.g. collapsing the bottom panel)
 * only detaches the view — the pty keeps running, and the parent closes it.
 */
export function TerminalView({
  sessionId,
  onExit,
}: {
  sessionId: string;
  onExit?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Keep the exit callback fresh without re-running the whole pty attachment.
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const desktop = isDesktop();

  useEffect(() => {
    if (!desktop) return;
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace',
      fontSize: 12,
      theme: themeFrom(host),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const reportError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      term.write(`\r\n\x1b[31m[terminal error: ${msg}]\x1b[0m\r\n`);
    };

    // User keystrokes -> pty.
    const dataSub = term.onData((data) => {
      backend.terminalWrite(sessionId, data).catch(reportError);
    });

    const resize = () => {
      try {
        fit.fit();
      } catch {
        // Container may be 0-sized (panel collapsed) — skip until it is visible.
        return;
      }
      backend.terminalResize(sessionId, term.cols, term.rows).catch(reportError);
    };

    let disposed = false;
    let unlistenData: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;

    const attach = async () => {
      try {
        const [d, e] = await Promise.all([
          listen<TerminalDataEvent>("terminal:data", ({ payload }) => {
            if (payload.id !== sessionId) return;
            term.write(payload.data);
          }),
          listen<TerminalExitEvent>("terminal:exit", ({ payload }) => {
            if (payload.id !== sessionId) return;
            const code = payload.code;
            term.write(
              code === null || code === undefined
                ? "\r\n[process exited]\r\n"
                : `\r\n[process exited with code ${code}]\r\n`,
            );
            onExitRef.current?.();
          }),
        ]);
        if (disposed) {
          d();
          e();
          return;
        }
        unlistenData = d;
        unlistenExit = e;
      } catch (err) {
        reportError(err);
      }
    };
    void attach();

    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(host);

    // Follow the app's light/dark theme.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = themeFrom(host);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    return () => {
      disposed = true;
      observer.disconnect();
      themeObserver.disconnect();
      dataSub.dispose();
      unlistenData?.();
      unlistenExit?.();
      term.dispose();
      // Deliberately no backend.terminalClose(): the pty outlives this view.
    };
  }, [sessionId, desktop]);

  if (!desktop) {
    return (
      <div style={noticeStyle}>
        The integrated terminal needs the desktop app — it runs a real shell in a PTY.
      </div>
    );
  }

  return <div ref={hostRef} style={shellStyle} />;
}
