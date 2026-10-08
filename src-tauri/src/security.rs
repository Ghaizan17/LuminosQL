//! Security primitives. Phase 1: destructive-query classifier contract.
//! Real `CredentialStore` (keyring) lands in Phase 2.

/// Statements that require the destructive-query modal / Safe Mode gate.
const DESTRUCTIVE_PREFIXES: &[&str] = &[
    "drop database",
    "drop table",
    "truncate",
    "delete",
    "update",
];

/// True when `sql` needs the ⚠ Destructive Query confirmation.
/// `DELETE`/`UPDATE` without `WHERE` are always destructive; with `WHERE` they
/// still warn (Safe Mode may block outright on production connections).
pub fn is_destructive(sql: &str) -> bool {
    let s = sql.trim_start().to_lowercase();
    if s.starts_with("delete") || s.starts_with("update") {
        return true;
    }
    DESTRUCTIVE_PREFIXES
        .iter()
        .any(|p| s.starts_with(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_destructive_statements() {
        assert!(is_destructive("DROP TABLE users"));
        assert!(is_destructive("  truncate orders"));
        assert!(is_destructive("DELETE FROM users"));
        assert!(is_destructive("UPDATE users SET name = 'x'"));
        assert!(!is_destructive("SELECT * FROM users"));
    }
}
