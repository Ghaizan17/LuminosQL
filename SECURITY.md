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

- Tauri IPC allowlist: only registered commands are invocable; no `fs`/`shell`
  access beyond the workspace scope.
- `npm audit` and `cargo audit` run in CI (Phase 10); Phase 1 runs `npm audit`
  manually before release tags.

## 5. Local data

- Query history and settings are local-only SQLite; export is explicit user action.
- AI features (Phase 9) MUST be opt-in and MUST NOT transmit schema without
  explicit per-request consent.
