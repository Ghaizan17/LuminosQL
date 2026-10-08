/** Local-first logger: levels, secret redaction, bounded ring buffer.
 *  Nothing leaves the machine unless the user explicitly downloads or
 *  pastes the log (crash reports are user-confirmed exports, never uploads).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  message: string;
}

const CAPACITY = 500;

const SECRET_PATTERNS = [
  /password\s*=\s*[^\s&;']+/gi,
  /passwd\s*=\s*[^\s&;']+/gi,
  /pwd\s*=\s*[^\s&;']+/gi,
  /:\/\/[^/\s:]+:[^/\s@]+@/g,
  /sk-[A-Za-z0-9-_]{8,}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/=]+/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m) => (m.includes("://") ? m.split(":")[0] + "://***:***@" : "[redacted]"));
  }
  return out;
}

class Logger {
  private entries: LogEntry[] = [];
  private listeners = new Set<() => void>();

  log(level: LogLevel, scope: string, message: string): void {
    this.entries.push({ at: Date.now(), level, scope, message: redactSecrets(message) });
    if (this.entries.length > CAPACITY) this.entries.splice(0, this.entries.length - CAPACITY);
    for (const l of this.listeners) l();
  }

  debug(scope: string, message: string): void {
    this.log("debug", scope, message);
  }

  info(scope: string, message: string): void {
    this.log("info", scope, message);
  }

  warn(scope: string, message: string): void {
    this.log("warn", scope, message);
  }

  error(scope: string, message: string): void {
    this.log("error", scope, message);
  }

  snapshot(level: LogLevel = "debug"): LogEntry[] {
    const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return this.entries.filter((e) => order[e.level] >= order[level]);
  }

  download(): void {
    const text = this.snapshot()
      .map((e) => `${new Date(e.at).toISOString()} [${e.level}] ${e.scope}: ${e.message}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `luminosql-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

export const logger = new Logger();

/** Route uncaught errors into the log (crash-report plumbing). Call once. */
export function installCrashHandlers(): void {
  window.addEventListener("error", (e) => {
    logger.error("crash", `${e.message} @ ${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    logger.error("crash", `unhandled rejection: ${String((e as PromiseRejectionEvent).reason)}`);
  });
}
