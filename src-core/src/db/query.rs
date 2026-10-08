//! Query execution: one statement in, a capped page of JSON rows out (Phase 4).
//! Streaming take keeps million-row results from ever filling memory;
//! Phase 5 adds keyset paging on top of the same page shape.

use super::FriendlyError;
use serde::Serialize;
use std::time::Duration;

pub const QUERY_ROW_LIMIT: usize = 500;
pub const QUERY_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QueryColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QueryPage {
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: u64,
    pub elapsed_ms: u64,
    pub truncated: bool,
}

/// True for statements that return rows (fetched); everything else goes
/// through `execute` for an affected count. `WITH … DELETE/UPDATE` is the
/// known edge: it fetches (possibly empty) with affected 0.
pub fn returns_rows(sql: &str) -> bool {
    let s = sql
        .trim_start_matches(|c: char| c == '(' || c == ';' || c.is_whitespace())
        .to_lowercase();
    ["select", "with", "values", "explain", "show", "table", "describe", "desc", "pragma"]
        .iter()
        .any(|k| s.starts_with(k))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub mod pg {
    use super::*;
    use futures::TryStreamExt;
    use sqlx::{Column, Row, TypeInfo};

    pub async fn fetch_page(
        pool: &sqlx::PgPool,
        sql: &str,
    ) -> Result<QueryPage, FriendlyError> {
        let start = std::time::Instant::now();
        let mut stream = sqlx::query(sql).fetch(pool);
        let mut columns: Option<Vec<QueryColumn>> = None;
        let mut rows = Vec::new();
        let mut truncated = false;
        while let Some(row) = tokio::time::timeout(QUERY_TIMEOUT, stream.try_next())
            .await
            .map_err(|_| super::timeout_err())?
            .map_err(|e| super::super::postgres::map_error("PostgreSQL", &e.to_string()))?
        {
            if columns.is_none() {
                columns = Some(
                    row.columns()
                        .iter()
                        .map(|c| QueryColumn { name: c.name().to_string(), data_type: c.type_info().name().to_string() })
                        .collect(),
                );
            }
            if rows.len() >= QUERY_ROW_LIMIT {
                truncated = true;
                break;
            }
            rows.push(decode(&row));
        }
        Ok(QueryPage {
            columns: columns.unwrap_or_default(),
            rows,
            rows_affected: 0,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
        })
    }

    fn decode(row: &sqlx::postgres::PgRow) -> Vec<serde_json::Value> {
        use serde_json::Value;
        (0..row.len())
            .map(|i| {
                if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
                    return v.map_or(Value::Null, Value::from);
                }
                if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
                    return v.map_or(Value::Null, |f| {
                        serde_json::Number::from_f64(f).map_or(Value::Null, Value::Number)
                    });
                }
                if let Ok(v) = row.try_get::<Option<bool>, _>(i) {
                    return v.map_or(Value::Null, Value::from);
                }
                if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                    return v.map_or(Value::Null, Value::from);
                }
                if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
                    return v.map_or(Value::Null, |b| Value::from(hex(&b)));
                }
                Value::String("<undecodable>".to_string())
            })
            .collect()
    }
}

pub mod my {
    use super::*;
    use futures::TryStreamExt;
    use sqlx::{Column, Row, TypeInfo};

    pub async fn fetch_page(
        pool: &sqlx::MySqlPool,
        sql: &str,
    ) -> Result<QueryPage, FriendlyError> {
        let start = std::time::Instant::now();
        let mut stream = sqlx::query(sql).fetch(pool);
        let mut columns: Option<Vec<QueryColumn>> = None;
        let mut rows = Vec::new();
        let mut truncated = false;
        while let Some(row) = tokio::time::timeout(QUERY_TIMEOUT, stream.try_next())
            .await
            .map_err(|_| super::timeout_err())?
            .map_err(|e| super::super::mysql::map_error(&e.to_string()))?
        {
            if columns.is_none() {
                columns = Some(
                    row.columns()
                        .iter()
                        .map(|c| QueryColumn { name: c.name().to_string(), data_type: c.type_info().name().to_string() })
                        .collect(),
                );
            }
            if rows.len() >= QUERY_ROW_LIMIT {
                truncated = true;
                break;
            }
            rows.push(decode(&row));
        }
        Ok(QueryPage {
            columns: columns.unwrap_or_default(),
            rows,
            rows_affected: 0,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
        })
    }

    fn decode(row: &sqlx::mysql::MySqlRow) -> Vec<serde_json::Value> {
        use serde_json::Value;
        (0..row.len())
            .map(|i| {
                if let Ok(v) = row.try_get::<Option<i64>, _>(i) {
                    return v.map_or(Value::Null, Value::from);
                }
                if let Ok(v) = row.try_get::<Option<u64>, _>(i) {
                    return v.map_or(Value::Null, Value::from);
                }
                if let Ok(v) = row.try_get::<Option<f64>, _>(i) {
                    return v.map_or(Value::Null, |f| {
                        serde_json::Number::from_f64(f).map_or(Value::Null, Value::Number)
                    });
                }
                if let Ok(v) = row.try_get::<Option<String>, _>(i) {
                    return v.map_or(Value::Null, Value::from);
                }
                if let Ok(v) = row.try_get::<Option<Vec<u8>>, _>(i) {
                    return v.map_or(Value::Null, |b| Value::from(hex(&b)));
                }
                Value::String("<undecodable>".to_string())
            })
            .collect()
    }
}

pub mod lite {
    use super::*;
    use futures::TryStreamExt;
    use sqlx::{Column, Row, TypeInfo};

    pub async fn fetch_page(
        pool: &sqlx::SqlitePool,
        sql: &str,
    ) -> Result<QueryPage, FriendlyError> {
        let start = std::time::Instant::now();
        let mut stream = sqlx::query(sql).fetch(pool);
        let mut columns: Option<Vec<QueryColumn>> = None;
        let mut rows = Vec::new();
        let mut truncated = false;
        while let Some(row) = tokio::time::timeout(QUERY_TIMEOUT, stream.try_next())
            .await
            .map_err(|_| super::timeout_err())?
            .map_err(|e| super::super::sqlite::map_error(&e.to_string()))?
        {
            if columns.is_none() {
                columns = Some(
                    row.columns()
                        .iter()
                        .map(|c| QueryColumn { name: c.name().to_string(), data_type: c.type_info().name().to_string() })
                        .collect(),
                );
            }
            if rows.len() >= QUERY_ROW_LIMIT {
                truncated = true;
                break;
            }
            rows.push(decode(&row));
        }
        Ok(QueryPage {
            columns: columns.unwrap_or_default(),
            rows,
            rows_affected: 0,
            elapsed_ms: start.elapsed().as_millis() as u64,
            truncated,
        })
    }

    fn decode(row: &sqlx::sqlite::SqliteRow) -> Vec<serde_json::Value> {
        use serde_json::Value;
        use sqlx::ValueRef;
        (0..row.len())
            .map(|i| {
                if matches!(row.try_get_raw(i), Ok(r) if r.is_null()) {
                    return Value::Null;
                }
                if let Ok(v) = row.try_get::<i64, _>(i) {
                    return Value::from(v);
                }
                if let Ok(v) = row.try_get::<f64, _>(i) {
                    return serde_json::Number::from_f64(v).map_or(Value::Null, Value::Number);
                }
                if let Ok(v) = row.try_get::<String, _>(i) {
                    return Value::from(v);
                }
                if let Ok(v) = row.try_get::<Vec<u8>, _>(i) {
                    return Value::from(hex(&v));
                }
                Value::String("<undecodable>".to_string())
            })
            .collect()
    }
}

fn timeout_err() -> FriendlyError {
    FriendlyError::new(
        "Query timed out.",
        "timeout",
        &["The statement ran longer than 60 seconds.", "Narrow it with WHERE / LIMIT, or cancel it."],
    )
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_statements() {
        assert!(returns_rows("SELECT 1"));
        assert!(returns_rows("  (select 1)"));
        assert!(returns_rows("WITH x AS (SELECT 1) SELECT * FROM x"));
        assert!(returns_rows("EXPLAIN SELECT 1"));
        assert!(!returns_rows("DELETE FROM t"));
        assert!(!returns_rows("CREATE TABLE t (id INT)"));
        assert!(!returns_rows("UPDATE t SET a = 1"));
    }
}
