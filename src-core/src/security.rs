//! Security primitives: destructive-query classifier, secret redaction,
//! and the `CredentialStore` abstraction (SECURITY.md §1).

/// Statements that require the ⚠ Destructive Query confirmation.
/// `DELETE`/`UPDATE` always warn, even with `WHERE` — Safe Mode may block them
/// outright on production connections.
pub fn is_destructive(sql: &str) -> bool {
    let s = sql.trim_start().to_lowercase();
    s.starts_with("drop database")
        || s.starts_with("drop table")
        || s.starts_with("truncate")
        || s.starts_with("delete")
        || s.starts_with("update")
}

/// Strip secret-looking fragments (`password=…`, `passwd=…`, `pwd=…`,
/// `://user:pass@`) from text destined for logs, errors, or the UI.
pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for key in ["password", "passwd", "pwd"] {
        let mut search = 0;
        while let Some(i) = out[search..].to_lowercase().find(&format!("{key}=")) {
            let abs = search + i + key.len() + 1;
            let end = out[abs..].find([' ', '&', ';', '\n', '\'']).map(|e| abs + e).unwrap_or(out.len());
            out.replace_range(abs..end, "***");
            search = abs + 3;
        }
    }
    // URL userinfo: scheme://user:secret@host
    let mut result = String::with_capacity(out.len());
    let mut rest = out.as_str();
    while let Some(scheme) = rest.find("://") {
        let after = &rest[scheme + 3..];
        if let (Some(colon), Some(at)) = (after.find(':').map(|i| scheme + 3 + i), after.find('@')) {
            let at_abs = scheme + 3 + at;
            if colon < at_abs {
                result.push_str(&rest[..=colon]);
                result.push_str("***");
                rest = &rest[at_abs..];
                continue;
            }
        }
        result.push_str(&rest[..scheme + 3]);
        rest = &rest[scheme + 3..];
    }
    result.push_str(rest);
    result
}

/// Secrets live ONLY here. Implementations: [`KeyringStore`] (OS keyring,
/// production) and [`MemoryStore`] (session-only fallback + tests — never disk).
pub trait CredentialStore: Send + Sync {
    fn set_password(&self, service: &str, account: &str, password: &str) -> Result<(), String>;
    fn get_password(&self, service: &str, account: &str) -> Result<Option<String>, String>;
    fn delete_password(&self, service: &str, account: &str) -> Result<(), String>;
}

/// Production store: Secret Service (Linux) / Credential Manager (Windows).
pub struct KeyringStore;

impl CredentialStore for KeyringStore {
    fn set_password(&self, service: &str, account: &str, password: &str) -> Result<(), String> {
        keyring::Entry::new(service, account)
            .and_then(|e| e.set_password(password))
            .map_err(|e| format!("credential store unavailable: {e}"))
    }

    fn get_password(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        match keyring::Entry::new(service, account).and_then(|e| e.get_password()) {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("credential store unavailable: {e}")),
        }
    }

    fn delete_password(&self, service: &str, account: &str) -> Result<(), String> {
        match keyring::Entry::new(service, account).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("credential store unavailable: {e}")),
        }
    }
}

/// Session-memory store. Nothing touches disk; entries vanish on drop.
pub struct MemoryStore {
    inner: std::sync::Mutex<std::collections::HashMap<String, String>>,
}

impl MemoryStore {
    pub fn new() -> Self {
        Self { inner: std::sync::Mutex::new(std::collections::HashMap::new()) }
    }
}

impl Default for MemoryStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialStore for MemoryStore {
    fn set_password(&self, service: &str, account: &str, password: &str) -> Result<(), String> {
        self.inner.lock().map_err(|e| e.to_string())?.insert(key(service, account), password.to_string());
        Ok(())
    }

    fn get_password(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        Ok(self.inner.lock().map_err(|e| e.to_string())?.get(&key(service, account)).cloned())
    }

    fn delete_password(&self, service: &str, account: &str) -> Result<(), String> {
        self.inner.lock().map_err(|e| e.to_string())?.remove(&key(service, account));
        Ok(())
    }
}

/// Runtime-selected store: OS keyring when available, session memory otherwise.
/// The memory fallback NEVER touches disk — connections simply forget passwords
/// on restart, and the UI reports which store is active.
pub enum AnyStore {
    Key(KeyringStore),
    Mem(MemoryStore),
}

impl AnyStore {
    pub fn auto() -> Self {
        let probe = KeyringStore;
        let canary =
            probe.set_password(crate::connections::SERVICE_NAME, "__probe__", "probe");
        if canary.is_ok() {
            let _ = probe.delete_password(crate::connections::SERVICE_NAME, "__probe__");
            AnyStore::Key(probe)
        } else {
            AnyStore::Mem(MemoryStore::new())
        }
    }

    pub fn is_os_backed(&self) -> bool {
        matches!(self, AnyStore::Key(_))
    }
}

impl CredentialStore for AnyStore {
    fn set_password(&self, service: &str, account: &str, password: &str) -> Result<(), String> {
        match self {
            AnyStore::Key(s) => s.set_password(service, account, password),
            AnyStore::Mem(s) => s.set_password(service, account, password),
        }
    }

    fn get_password(&self, service: &str, account: &str) -> Result<Option<String>, String> {
        match self {
            AnyStore::Key(s) => s.get_password(service, account),
            AnyStore::Mem(s) => s.get_password(service, account),
        }
    }

    fn delete_password(&self, service: &str, account: &str) -> Result<(), String> {
        match self {
            AnyStore::Key(s) => s.delete_password(service, account),
            AnyStore::Mem(s) => s.delete_password(service, account),
        }
    }
}

fn key(service: &str, account: &str) -> String {
    format!("{service}\x1f{account}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_destructive_statements() {
        assert!(is_destructive("DROP TABLE users"));
        assert!(is_destructive("  truncate orders"));
        assert!(is_destructive("DELETE FROM users"));
        assert!(is_destructive("DELETE FROM users WHERE id = 1"));
        assert!(is_destructive("UPDATE users SET name = 'x'"));
        assert!(!is_destructive("SELECT * FROM users"));
    }

    #[test]
    fn redacts_passwords_and_url_userinfo() {
        assert_eq!(redact("password=hunter2 ok"), "password=*** ok");
        assert_eq!(
            redact("postgres://admin:hunter2@localhost:5432/db"),
            "postgres://admin:***@localhost:5432/db"
        );
        assert_eq!(redact("SELECT 1"), "SELECT 1");
    }

    #[test]
    fn memory_store_round_trips() {
        let s = MemoryStore::new();
        assert_eq!(s.get_password("svc", "a").unwrap(), None);
        s.set_password("svc", "a", "secret").unwrap();
        assert_eq!(s.get_password("svc", "a").unwrap(), Some("secret".to_string()));
        s.delete_password("svc", "a").unwrap();
        assert_eq!(s.get_password("svc", "a").unwrap(), None);
    }
}
