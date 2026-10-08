//! MySQL / MariaDB adapter (sqlx + rustls).

use super::{FriendlyError, ServerInfo, CONNECT_TIMEOUT};
use sqlx::mysql::MySqlPoolOptions;

pub struct MysqlAdapter {
    host: String,
    port: u16,
    database: String,
    username: String,
    password: String,
    pool: Option<sqlx::MySqlPool>,
}

impl MysqlAdapter {
    pub fn new(host: &str, port: u16, database: &str, username: &str, password: &str) -> Self {
        Self {
            host: host.to_string(),
            port,
            database: database.to_string(),
            username: username.to_string(),
            password: password.to_string(),
            pool: None,
        }
    }

    fn url(&self) -> String {
        format!(
            "mysql://{}:{}@{}:{}/{}",
            self.username, self.password, self.host, self.port, self.database
        )
    }
}
#[async_trait::async_trait]

impl super::DatabaseAdapter for MysqlAdapter {
    async fn connect(&mut self) -> Result<(), FriendlyError> {
        let pool = tokio::time::timeout(
            CONNECT_TIMEOUT,
            MySqlPoolOptions::new().max_connections(1).connect(&self.url()),
        )
        .await
        .map_err(|_| {
            FriendlyError::new(
                "Connection timed out.",
                "timeout",
                &["The server did not answer within 10 seconds.", "Host or port may be wrong."],
            )
        })?
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
        let (version,): (String,) = sqlx::query_as("SELECT VERSION()")
            .fetch_one(pool)
            .await
            .map_err(|e| map_error(&e.to_string()))?;
        Ok(ServerInfo {
            engine: "MySQL".to_string(),
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
        let rows = sqlx::query(
            "SELECT schema_name FROM information_schema.schemata \
             WHERE schema_name NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') \
             ORDER BY schema_name",
        )
        .fetch_all(self.my_pool()?)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        use sqlx::Row;
        Ok(rows.into_iter().map(|r| super::schema::SchemaInfo { name: r.get("schema_name") }).collect())
    }

    async fn list_tables(&self, schema: &str) -> Result<Vec<super::schema::TableInfo>, FriendlyError> {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT table_name, table_type FROM information_schema.tables \
             WHERE table_schema = ? AND table_type IN ('BASE TABLE', 'VIEW', 'SYSTEM VIEW') ORDER BY table_name",
        )
        .bind(schema)
        .fetch_all(self.my_pool()?)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let t: String = r.get("table_type");
                super::schema::TableInfo {
                    schema: schema.to_string(),
                    name: r.get("table_name"),
                    kind: if t == "BASE TABLE" { super::schema::TableKind::Table } else { super::schema::TableKind::View },
                }
            })
            .collect())
    }

    async fn describe_table(&self, schema: &str, table: &str) -> Result<super::schema::TableDef, FriendlyError> {
        use super::schema::*;
        use sqlx::Row;
        let pool = self.my_pool()?;
        let kind = self.table_kind(schema, table).await?;
        let col_rows = sqlx::query(
            "SELECT column_name, column_type, is_nullable, column_default \
             FROM information_schema.columns \
             WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        if col_rows.is_empty() {
            return Err(FriendlyError::new(
                &format!("Table `{schema}`.`{table}` not found."),
                "unknown-table",
                &["It may have been dropped or renamed.", "Refresh the explorer and try again."],
            ));
        }
        let pk_rows = sqlx::query(
            "SELECT column_name FROM information_schema.statistics \
             WHERE table_schema = ? AND table_name = ? AND index_name = 'PRIMARY' ORDER BY seq_in_index",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        let pk_pos: std::collections::HashMap<String, i64> = pk_rows
            .into_iter()
            .enumerate()
            .map(|(i, r)| (r.get("column_name"), i as i64 + 1))
            .collect();
        let columns = col_rows
            .into_iter()
            .map(|r| {
                let name: String = r.get("column_name");
                let is_null: String = r.get("is_nullable");
                ColumnInfo {
                    pk_position: pk_pos.get(&name).copied(),
                    name,
                    data_type: r.get("column_type"),
                    nullable: is_null == "YES",
                    default: r.get("column_default"),
                }
            })
            .collect();
        let stat_rows = sqlx::query(
            "SELECT index_name, column_name, seq_in_index, non_unique \
             FROM information_schema.statistics \
             WHERE table_schema = ? AND table_name = ? ORDER BY index_name, seq_in_index",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        let mut indexes: Vec<IndexInfo> = Vec::new();
        for r in stat_rows {
            let idx_name: String = r.get("index_name");
            let col: String = r.get("column_name");
            let non_unique: i64 = r.get("non_unique");
            match indexes.last_mut().filter(|ix| ix.name == idx_name) {
                Some(ix) => ix.columns.push(col),
                None => indexes.push(IndexInfo {
                    name: idx_name.clone(),
                    columns: vec![col],
                    unique: non_unique == 0,
                    primary: idx_name == "PRIMARY",
                }),
            }
        }
        let fk_rows = sqlx::query(
            "SELECT constraint_name, column_name, referenced_table_schema, \
             referenced_table_name, referenced_column_name \
             FROM information_schema.key_column_usage \
             WHERE table_schema = ? AND table_name = ? AND referenced_table_name IS NOT NULL \
             ORDER BY constraint_name, ordinal_position",
        )
        .bind(schema)
        .bind(table)
        .fetch_all(pool)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        let mut foreign_keys: Vec<ForeignKeyInfo> = Vec::new();
        for r in fk_rows {
            let fk_name: String = r.get("constraint_name");
            let col: String = r.get("column_name");
            let ref_col: String = r.get("referenced_column_name");
            match foreign_keys.last_mut().filter(|fk| fk.name == fk_name) {
                Some(fk) => {
                    fk.columns.push(col);
                    fk.ref_columns.push(ref_col);
                }
                None => foreign_keys.push(ForeignKeyInfo {
                    name: fk_name,
                    columns: vec![col],
                    ref_schema: r.get("referenced_table_schema"),
                    ref_table: r.get("referenced_table_name"),
                    ref_columns: vec![ref_col],
                }),
            }
        }
        Ok(TableDef { schema: schema.to_string(), name: table.to_string(), kind, columns, indexes, foreign_keys })
    }

    async fn list_functions(&self, schema: &str) -> Result<Vec<super::schema::FunctionInfo>, FriendlyError> {
        use sqlx::Row;
        let rows = sqlx::query(
            "SELECT routine_name, routine_type, data_type, external_language \
             FROM information_schema.routines WHERE routine_schema = ? ORDER BY routine_name",
        )
        .bind(schema)
        .fetch_all(self.my_pool()?)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|r| super::schema::FunctionInfo {
                schema: schema.to_string(),
                name: r.get("routine_name"),
                arguments: r.get::<String, _>("routine_type"),
                return_type: r.get::<Option<String>, _>("data_type").unwrap_or_default(),
                language: r.get::<Option<String>, _>("external_language").unwrap_or_default(),
            })
            .collect())
    }

    async fn execute(&self, sql: &str) -> Result<u64, FriendlyError> {
        Ok(sqlx::query(sql)
            .execute(self.my_pool()?)
            .await
            .map_err(|e| map_error(&e.to_string()))?
            .rows_affected())
    }

    async fn query(&self, sql: &str) -> Result<super::query::QueryPage, FriendlyError> {
        if super::query::returns_rows(sql) {
            super::query::my::fetch_page(self.my_pool()?, sql).await
        } else {
            let start = std::time::Instant::now();
            let rows_affected = self.execute(sql).await?;
            Ok(super::query::QueryPage {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected,
                elapsed_ms: start.elapsed().as_millis() as u64,
                truncated: false,
            })
        }
    }
}
impl MysqlAdapter {
    fn my_pool(&self) -> Result<&sqlx::MySqlPool, FriendlyError> {
        self.pool
            .as_ref()
            .ok_or_else(|| FriendlyError::new("Not connected.", "not-connected", &[]))
    }

    async fn table_kind(&self, schema: &str, table: &str) -> Result<super::schema::TableKind, FriendlyError> {
        let row: Option<(String,)> = sqlx::query_as(
            "SELECT table_type FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
        )
        .bind(schema)
        .bind(table)
        .fetch_optional(self.my_pool()?)
        .await
        .map_err(|e| map_error(&e.to_string()))?;
        Ok(match row.map(|r| r.0).as_deref() {
            Some("BASE TABLE") => super::schema::TableKind::Table,
            Some(_) => super::schema::TableKind::View,
            None => super::schema::TableKind::Table,
        })
    }
}

pub(super) fn map_error(msg: &str) -> FriendlyError {
    let m = msg.to_lowercase();
    if m.contains("connection refused") {
        FriendlyError::new(
            "Could not connect to MySQL.",
            "connection-refused",
            &[
                "MySQL is not running on this host/port.",
                "Host or port is incorrect.",
                "A firewall may be blocking the connection.",
            ],
        )
    } else if m.contains("access denied") {
        FriendlyError::new(
            "MySQL rejected the credentials.",
            "auth-failed",
            &["Username or password is incorrect.", "Check the user exists and the host part allows this client."],
        )
    } else if m.contains("unknown database") {
        FriendlyError::new(
            "Database does not exist.",
            "unknown-database",
            &["The database name is misspelled.", "Create it first, then reconnect."],
        )
    } else {
        FriendlyError::new("MySQL error.", "driver-error", &[msg])
    }
}
