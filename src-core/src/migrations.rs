//! File-based migration system (Phase 6).
//!
//! Convention: `migrations/001_create_users.sql`, one file per migration.
//! A `-- DOWN` marker line splits reversible migrations; without it the
//! migration applies forward-only and rollback refuses honestly.
//! Applied versions live in `_luminosql_migrations` with a checksum so
//! edited-after-apply migrations are flagged, not silently skipped.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const DOWN_MARKER: &str = "-- DOWN";
pub const JOURNAL_TABLE: &str = "_luminosql_migrations";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MigrationFile {
    pub version: String,
    pub name: String,
    pub up_sql: String,
    pub down_sql: Option<String>,
    pub checksum: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MigrationState {
    pub version: String,
    pub name: String,
    pub applied: bool,
    /// False when the file changed since it was applied.
    pub checksum_ok: bool,
}

/// Parse `001_create_users.sql` + body into a `MigrationFile`.
/// Returns `None` when the filename carries no numeric version prefix.
pub fn parse_file(filename: &str, body: &str) -> Option<MigrationFile> {
    let stem = filename.strip_suffix(".sql")?;
    let (version, name) = stem.split_once(['_', '-'])?;
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_digit()) || name.is_empty() {
        return None;
    }
    let (up, down) = split_directions(body);
    let up_sql = up.trim().to_string();
    if up_sql.is_empty() {
        return None;
    }
    Some(MigrationFile {
        version: version.to_string(),
        name: name.to_string(),
        up_sql: up_sql.clone(),
        down_sql: down.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()),
        checksum: checksum(&up_sql),
    })
}

fn split_directions(body: &str) -> (&str, Option<&str>) {
    let mut marker_at: Option<usize> = None;
    let mut line_start = 0;
    for line in body.split_inclusive('\n') {
        if line.trim() == DOWN_MARKER {
            marker_at = Some(line_start);
            break;
        }
        line_start += line.len();
    }
    match marker_at {
        Some(i) => (&body[..i], Some(&body[i + DOWN_MARKER.len()..])),
        None => (body, None),
    }
}

pub fn checksum(sql: &str) -> String {
    format!("{:x}", Sha256::digest(sql.as_bytes()))
}

/// Split a script into statements. Respects single/double/backtick quotes,
/// line + block comments, and PostgreSQL dollar-quoted bodies (`$$…$$`,
/// `$tag$…$tag$`). Empty statements are dropped.
pub fn split_statements(script: &str) -> Vec<String> {
    let bytes = script.as_bytes();
    let mut out = Vec::new();
    let mut current = String::new();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i] as char;
        // Line comment.
        if c == '-' && bytes.get(i + 1) == Some(&b'-') {
            while i < bytes.len() && bytes[i] != b'\n' {
                current.push(bytes[i] as char);
                i += 1;
            }
            continue;
        }
        // Block comment.
        if c == '/' && bytes.get(i + 1) == Some(&b'*') {
            current.push_str("/*");
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                current.push(bytes[i] as char);
                i += 1;
            }
            if i + 1 < bytes.len() {
                current.push_str("*/");
                i += 2;
            }
            continue;
        }
        // Quoted string/identifier.
        if c == '\'' || c == '"' || c == '`' {
            current.push(c);
            i += 1;
            while i < bytes.len() {
                let d = bytes[i] as char;
                current.push(d);
                i += 1;
                if d == c {
                    if bytes.get(i) == Some(&(c as u8)) {
                        current.push(c);
                        i += 1;
                        continue;
                    }
                    break;
                }
            }
            continue;
        }
        // Dollar-quoted body (pg function bodies).
        if c == '$' {
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                j += 1;
            }
            if j < bytes.len() && bytes[j] == b'$' {
                let tag = &script[i..=j];
                if let Some(end) = script[j + 1..].find(tag) {
                    current.push_str(&script[i..j + 1 + end + tag.len()]);
                    i = j + 1 + end + tag.len();
                    continue;
                }
            }
            current.push(c);
            i += 1;
            continue;
        }
        if c == ';' {
            if !current.trim().is_empty() {
                out.push(current.trim().to_string());
            }
            current = String::new();
            i += 1;
            continue;
        }
        current.push(c);
        i += 1;
    }
    if !current.trim().is_empty() {
        out.push(current.trim().to_string());
    }
    out
}

pub fn journal_ddl(engine: crate::connections::Engine) -> String {
    // MySQL cannot index a bare TEXT column — bounded VARCHAR there.
    let v = match engine {
        crate::connections::Engine::Mysql => "VARCHAR(255)",
        _ => "TEXT",
    };
    format!(
        "CREATE TABLE IF NOT EXISTS {JOURNAL_TABLE} \
         (version {v} PRIMARY KEY, name {v} NOT NULL, checksum {v} NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versioned_files_and_down_sections() {
        let m = parse_file("001_create_users.sql", "CREATE TABLE users (id INT);\n-- DOWN\nDROP TABLE users;").unwrap();
        assert_eq!((m.version.as_str(), m.name.as_str()), ("001", "create_users"));
        assert!(m.down_sql.is_some());
        assert_eq!(m.checksum.len(), 64);
        let once = parse_file("002_seed.sql", "INSERT INTO users VALUES (1);").unwrap();
        assert!(once.down_sql.is_none());
    }

    #[test]
    fn rejects_unversioned_or_empty_files() {
        assert!(parse_file("readme.sql", "SELECT 1").is_none());
        assert!(parse_file("003_empty.sql", "  \n-- DOWN\nDROP TABLE x;").is_none());
        assert!(parse_file("notes.txt", "SELECT 1").is_none());
    }

    #[test]
    fn splitter_respects_functions_strings_and_comments() {
        let script = "CREATE TABLE a (id INT); -- trailing; comment\n\
             CREATE FUNCTION f() RETURNS INT AS $$ BEGIN RETURN 1; END; $$ LANGUAGE plpgsql;\n\
             INSERT INTO a VALUES ('semi;colon', \"dq;x\");";
        let parts = split_statements(script);
        assert_eq!(parts.len(), 3);
        assert!(parts[1].contains("RETURN 1; END;"));
        assert!(parts[2].contains("'semi;colon'"));
    }
}
