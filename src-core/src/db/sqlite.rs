//! SQLite adapter (file or `:memory:`). "Connect" opens the file and probes it.

use super::{FriendlyError, ServerInfo, CONNECT_TIMEOUT};
use sqlx::sqlite::SqlitePoolOptions;

pub struct SqliteAdapter {
    path: String,
    pool: Option<sqlx::SqlitePool>,
}

impl SqliteAdapter {
    pub fn new(path: &str) -> Self {
        Self { path: path.to_string(), pool: None }
    }

    fn url(&self) -> String {
        if self.path == ":memory:" {
            "sqlite::memory:".to_string()
        } else {
            format!("sqlite://{}?mode=rwc", self.path)
        }
    }
}

#[async_trait::async_trait]
impl super::DatabaseAdapter for SqliteAdapter {
    async fn connect(&mut self) -> Result<(), FriendlyError> {
        let pool = tokio::time::timeout(
            CONNECT_TIMEOUT,
            SqlitePoolOptions::new().max_connections(1).connect(&self.url()),
        )
        .await
        .map_err(|_| FriendlyError::new("Timed out opening the database file.", "timeout", &[]))?
        .map_err(|e| map_error(&e.to_string()))?;
        // Probe: opening a path never fails on its own (mode=rwc creates it),
        // so run a real query to surface permission / corruption errors now.
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        self.pool = Some(pool);
        Ok(())
    }

    async fn ping(&mut self) -> Result<ServerInfo, FriendlyError> {
        let pool = self
            .pool
            .as_ref()
            .ok_or_else(|| FriendlyError::new("Not connected.", "not-connected", &[]))?;
        let start = std::time::Instant::now();
        let (version,): (String,) = sqlx::query_as("SELECT sqlite_version()")
            .fetch_one(pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        Ok(ServerInfo {
            engine: "SQLite".to_string(),
            version,
            latency_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn disconnect(&mut self) {
        if let Some(pool) = self.pool.take() {
            pool.close().await;
        }
    }

    fn is_connected(&self) -> bool {
        self.pool.as_ref().is_some_and(|p| !p.is_closed())
    }
    async fn list_schemas(&self) -> Result<Vec<super::schema::SchemaInfo>, FriendlyError> {
        Ok(vec![super::schema::SchemaInfo { name: "main".to_string() }])
    }

    async fn list_tables(&self, _schema: &str) -> Result<Vec<super::schema::TableInfo>, FriendlyError> {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT name, type FROM sqlite_master \
             WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .fetch_all(self.lite_pool()?)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let t: String = r.get("type");
                super::schema::TableInfo {
                    schema: "main".to_string(),
                    name: r.get("name"),
                    kind: if t == "view" { super::schema::TableKind::View } else { super::schema::TableKind::Table },
                }
            })
            .collect())
    }

    async fn describe_table(&self, schema: &str, table: &str) -> Result<super::schema::TableDef, FriendlyError> {
        use super::schema::*;
        use sqlx::Row;
        let pool = self.lite_pool()?;
        let kind = self.table_kind(table).await?;
        let col_rows = sqlx::query(&format!("PRAGMA table_info({})", quote_id(table)))
            .fetch_all(pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        if col_rows.is_empty() {
            return Err(FriendlyError::new(
                &format!("Table \"{table}\" not found."),
                "unknown-table",
                &["It may have been dropped or renamed.", "Refresh the explorer and try again."],
            ));
        }
        let columns = col_rows
            .into_iter()
            .map(|r| ColumnInfo {
                name: r.get("name"),
                data_type: r.get::<String, _>("type"),
                nullable: r.get::<i64, _>("notnull") == 0,
                default: r.get("dflt_value"),
                pk_position: match r.get::<i64, _>("pk") {
                    0 => None,
                    n => Some(n),
                },
            })
            .collect();
        let idx_list = sqlx::query(&format!("PRAGMA index_list({})", quote_id(table)))
            .fetch_all(pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        let mut indexes = Vec::new();
        for idx in idx_list {
            let idx_name: String = idx.get("name");
            let unique: i64 = idx.get("unique");
            let origin: String = idx.get("origin");
            let info_rows = sqlx::query(&format!("PRAGMA index_info({})", quote_id(&idx_name)))
                .fetch_all(pool)
                .await
                .map_err(|e| map_error(&e.to_string()))?;
            let mut cols: Vec<(i64, String)> =
                info_rows.into_iter().map(|r| (r.get("seqno"), r.get("name"))).collect();
            cols.sort_by_key(|(seq, _)| *seq);
            indexes.push(IndexInfo {
                primary: origin == "pk",
                unique: unique != 0,
                columns: cols.into_iter().map(|(_, c)| c).collect(),
                name: idx_name,
            });
        }
        let fk_rows = sqlx::query(&format!("PRAGMA foreign_key_list({})", quote_id(table)))
            .fetch_all(pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        let mut foreign_keys: Vec<ForeignKeyInfo> = Vec::new();
        for r in fk_rows {
            let id: i64 = r.get("id");
            let col: String = r.get("from");
            let ref_table: String = r.get("table");
            let ref_col: String = r.get("to");
            match foreign_keys.iter_mut().find(|fk| fk.name == format!("fk_{id}")) {
                Some(fk) => {
                    fk.columns.push(col);
                    fk.ref_columns.push(ref_col);
                }
                None => foreign_keys.push(ForeignKeyInfo {
                    name: format!("fk_{id}"),
                    columns: vec![col],
                    ref_schema: schema.to_string(),
                    ref_table,
                    ref_columns: vec![ref_col],
                }),
            }
        }
        Ok(TableDef { schema: schema.to_string(), name: table.to_string(), kind, columns, indexes, foreign_keys })
    }

    async fn list_functions(&self, _schema: &str) -> Result<Vec<super::schema::FunctionInfo>, FriendlyError> {
        Ok(Vec::new())
    }

    async fn execute(&self, sql: &str) -> Result<u64, FriendlyError> {
        Ok(sqlx::query(sql)
            .execute(self.lite_pool()?)
            .await
            .map_err(|e| map_error(&e.to_string()))?
            .rows_affected())
    }
}
impl SqliteAdapter {
    fn lite_pool(&self) -> Result<&sqlx::SqlitePool, FriendlyError> {
        self.pool
            .as_ref()
            .ok_or_else(|| FriendlyError::new("Not connected.", "not-connected", &[]))
    }

    async fn table_kind(&self, table: &str) -> Result<super::schema::TableKind, FriendlyError> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')")
                .bind(table)
                .fetch_optional(self.lite_pool()?)
                .await
                .map_err(|e| map_error(&e.to_string()))?;
        Ok(match row.map(|r| r.0).as_deref() {
            Some("view") => super::schema::TableKind::View,
            _ => super::schema::TableKind::Table,
        })
    }
}

/// Quote an identifier for PRAGMA position (no bind params allowed there).
/// Embedded double-quotes are escaped per SQLite rules.
fn quote_id(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn map_error(msg: &str) -> FriendlyError {
    let m = msg.to_lowercase();
    if m.contains("unable to open database file") {
        FriendlyError::new(
            "Could not open the SQLite file.",
            "file-unopenable",
            &[
                "The directory does not exist or is not writable.",
                "The path is misspelled.",
                "Another process locked the file.",
            ],
        )
    } else if m.contains("file is not a database") {
        FriendlyError::new(
            "The file is not a SQLite database.",
            "not-a-database",
            &["The file is corrupt or a different format.", "Pick the correct file."],
        )
    } else {
        FriendlyError::new("SQLite error.", "driver-error", &[msg])
    }
}
