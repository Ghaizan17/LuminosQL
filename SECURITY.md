# SECURITY — Database IDE

Binding rules. Violations block release.

## 1. Credentials

- Passwords and private keys live ONLY in the OS credential store:
  Linux Secret Service / libsecret (`keyring` crate), Windows Credential Manager.
- NEVER in: plaintext config, SQLite metadata, logs, error messages, telemetry,
  migration files, exported JSON.
- Connection configs on disk store `credential_ref`, never the secret.
- Memory: zeroize secret buffers after use; no secrets in Redux-style time-travel
  state or persisted tab snapshots.

## 2. Destructive queries

Statements matching `DROP DATABASE|DROP TABLE|TRUNCATE|DELETE|UPDATE` (without a
`WHERE` for the latter two, per the Rust classifier) require an explicit modal:

```text
⚠ Destructive Query — [Cancel] [Execute Anyway]
```

- A global **Safe Mode** (default ON for production-tagged connections) blocks them
  outright instead of warning.
- `DELETE`/`UPDATE` without `WHERE` are always classified destructive.

## 3. Error handling

- Raw driver errors are mapped to actionable UI errors (cause + fix hints).
- Errors MUST NOT leak host, port, user, or secret fragments. Redact before display
  and before logging (`security::redact()` in Rust, mirrored in TS for local errors).

## 4. IPC / supply chain

- Tauri IPC allowlist: only registered commands are invocable. There is **no**
  `fs` plugin and no `shell` plugin — the app has no general command-execution
  surface beyond the four `terminal_*` commands below.
- `npm audit` and `cargo audit` run in CI (Phase 10); Phase 1 runs `npm audit`
  manually before release tags.

## 4a. Integrated terminal (Phase 11)

The Terminal tab is a REAL pty (`portable-pty`: forkpty on Unix, ConPTY on
Windows) driven by xterm.js. This is the one place LuminosQL executes
arbitrary code, so it is deliberately fenced:

- **User-initiated only.** No pty is spawned at startup; the shell is created the
  first time the Terminal tab is opened. Nothing runs without a deliberate click.
- **Explicitly disclosed.** The tab states that the shell runs with the user's own
  privileges and full local access.
- **No credentials are injected.** The shell inherits the app's environment only;
  no database password, no AI key, and no credential-store value is ever written
  into it. Secrets in the keyring stay unreachable from the terminal by omission.
- **Inherits the OS security model.** Whatever the OS user can do, the spawned
  shell can do. LuminosQL adds no sandbox and MUST NOT be described as providing
  one.
- **Not persisted.** Terminals are not saved to workspaces; scrollback and history
  die with the process.
- Rejected by design: a hidden auto-start shell, remote/tunneled shells, and any
  "run this command from the UI" affordance that is not the user typing it.

## 5. Local data

- Query history and settings are local-only SQLite; export is explicit user action.
- AI features (Phase 9) MUST be opt-in and MUST NOT transmit schema without
  explicit per-request consent.
